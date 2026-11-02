import express from "express";
import sql from "./bd.js";
import {requireSession} from "./session.js";

const router=express.Router();
const ZONE="America/Sao_Paulo";

function dateLocal(offsetDays=0){
 const date=new Date(Date.now()+offsetDays*86400000);
 return new Intl.DateTimeFormat("en-CA",{timeZone:ZONE,year:"numeric",month:"2-digit",day:"2-digit"}).format(date);
}
function validateDate(value){
 if(typeof value!=="string" || !/^\d{4}-\d{2}-\d{2}$/.test(value))return null;
 const ms=Date.parse(value+"T12:00:00Z");
 if(!Number.isFinite(ms))return null;
 return new Date(ms).toISOString().slice(0,10)===value?value:null;
}
function period(req,res){
 const from=req.query.de===undefined?dateLocal(-29):validateDate(req.query.de);
 const to=req.query.ate===undefined?dateLocal():validateDate(req.query.ate);
 if(!from || !to || from>to || (Date.parse(to)-Date.parse(from)>366*86400000)){
  res.status(400).json({mensagem:"Informe datas válidas (AAAA-MM-DD), em ordem e com período de até 366 dias"});
  return null;
 }
 return {de:from,ate:to};
}
function fail(res,e){
 console.error("LajuStore operação:",e);
 return res.status(500).json({mensagem:"Não foi possível carregar os dados. Confira a conexão e tente novamente."});
}
const manager=(req,res,next)=>req.usuario?.role==="gestor"?next():
 res.status(403).json({mensagem:"Apenas a administradora pode acessar estes dados"});

router.use(requireSession);
router.use(async(req,res,next)=>{
 try{
  const [user]=await sql`SELECT id,role,ativo FROM loja_usuarios WHERE id=${req.session.id}`;
  if(!user?.ativo)return res.status(401).json({mensagem:"Sessão inválida. Entre novamente."});
  req.usuario=user;next();
 }catch(e){fail(res,e);}
});

// Lista de peças que precisam de reposição; funcionárias também podem consultar.
router.get("/estoque/alertas",async(req,res)=>{
 try{
  const [summary]=await sql`
   SELECT COUNT(*)::int AS total,
          COUNT(*) FILTER (WHERE v.quantidade=0)::int AS zerados
     FROM loja_variantes v
     JOIN loja_produtos p ON p.id=v.produto_id
    WHERE p.ativo=true AND v.quantidade<=v.minimo`;
  const items=await sql`
   SELECT v.id AS variante_id,p.id AS produto_id,p.nome,v.sku,v.tamanho,v.cor,
          v.quantidade,v.minimo, (v.minimo-v.quantidade)::int AS faltam,
          (v.quantidade=0) AS esgotado
     FROM loja_variantes v
     JOIN loja_produtos p ON p.id=v.produto_id
    WHERE p.ativo=true AND v.quantidade<=v.minimo
    ORDER BY (v.quantidade=0) DESC,(v.minimo-v.quantidade) DESC,p.nome ASC,v.id ASC
    LIMIT 100`;
  res.set("Cache-Control","no-store");
  res.json({total:summary.total,zerados:summary.zerados,itens:items,exibidos:items.length});
 }catch(e){fail(res,e);}
});

// Resultado operacional estimado: exclui compras de estoque das despesas de
// operação, pois o custo das roupas vendidas já compõe o cálculo de margem.
router.get("/financeiro/indicadores",manager,async(req,res)=>{
 const range=period(req,res);if(!range)return;
 const {de,ate}=range;
 try{
  const [sales]=await sql`
   WITH por_venda AS (
     SELECT p.id,p.desconto,
       COALESCE(SUM(i.quantidade*i.preco_unitario),0) AS bruto,
       COALESCE(SUM(i.quantidade*COALESCE(i.custo_unitario,prod.custo,0)),0) AS custos,
       COALESCE(SUM(i.quantidade) FILTER (
        WHERE i.id IS NOT NULL AND COALESCE(i.custo_unitario,prod.custo) IS NULL
       ),0)::int AS pecas_sem_custo
     FROM loja_pedidos p
     LEFT JOIN loja_pedido_itens i ON i.pedido_id=p.id
     LEFT JOIN loja_variantes v ON v.id=i.variante_id
     LEFT JOIN loja_produtos prod ON prod.id=v.produto_id
     WHERE p.status='pago'
       AND (COALESCE(p.finalizado_em,p.criado_em) AT TIME ZONE 'America/Sao_Paulo')::date
           BETWEEN ${de}::date AND ${ate}::date
     GROUP BY p.id
   )
   SELECT COUNT(*)::int AS vendas,
     COALESCE(SUM(bruto),0) AS bruto,
     COALESCE(SUM(desconto),0) AS descontos,
     COALESCE(SUM(custos),0) AS custos,
     COALESCE(SUM(pecas_sem_custo),0)::int AS pecas_sem_custo
   FROM por_venda`;
  const [ledger]=await sql`
   SELECT
    COALESCE(SUM(valor) FILTER (WHERE tipo='entrada' AND status='pago'),0) AS entradas,
    COALESCE(SUM(valor) FILTER (WHERE tipo='saida' AND status='pago'),0) AS saidas,
    COALESCE(SUM(valor) FILTER (
       WHERE tipo='saida' AND status='pago'
         AND compra_id IS NULL
         AND LOWER(TRIM(categoria)) NOT IN ('mercadorias','estorno')
    ),0) AS despesas_operacionais,
    COALESCE(SUM(valor) FILTER (WHERE tipo='entrada' AND status='pendente'),0) AS a_receber,
    COALESCE(SUM(valor) FILTER (WHERE tipo='saida' AND status='pendente'),0) AS a_pagar
   FROM loja_financeiro
   WHERE data_movimento BETWEEN ${de}::date AND ${ate}::date`;
  const revenue=Number(sales.bruto)-Number(sales.descontos);
  const margin=revenue-Number(sales.custos);
  const operating=margin-Number(ledger.despesas_operacionais);
  const entries=Number(ledger.entradas),exits=Number(ledger.saidas);
  res.set("Cache-Control","no-store");
  res.json({de,ate,vendas:sales.vendas,
   faturamento:Math.round(revenue*100)/100,
   descontos:Number(sales.descontos),
   custo_pecas_conhecido:Number(sales.custos),
   margem_vendas_estimada:Math.round(margin*100)/100,
   despesas_operacionais:Number(ledger.despesas_operacionais),
   resultado_operacional_estimado:Math.round(operating*100)/100,
   pecas_sem_custo:sales.pecas_sem_custo,
   entradas_caixa:entries,saidas_caixa:exits,saldo_caixa:Math.round((entries-exits)*100)/100,
   a_receber:Number(ledger.a_receber),a_pagar:Number(ledger.a_pagar),
   aviso:"Valores estimados de vendas confirmadas. Não substitui contabilidade: custos não cadastrados, tributos, taxas, outras receitas ou despesas não lançadas podem alterar o lucro. Compras de mercadorias não são deduzidas duas vezes. Fluxo de caixa inclui compras e estornos."});
 }catch(e){fail(res,e);}
});

// Exportação de consulta dos dados comerciais; não contém hashes ou contas.
// Não substitui cópia completa e testada de PostgreSQL feita com pg_dump.
const EXPORT_TABLES=Object.freeze([
 "loja_clientes",
 "loja_fornecedores",
 "loja_produtos",
 "loja_variantes",
 "loja_pedidos",
 "loja_pedido_itens",
 "loja_movimentos",
 "loja_compras",
 "loja_compra_itens",
 "loja_financeiro",
 "loja_auditoria_v7",
 "loja_crediario",
 "loja_crediario_parcelas",
 "loja_crediario_pagamentos"
]);
const ROW_LIMIT=5000;
const EXPORT_BYTES=15*1024*1024;
router.get("/exportacao/dados-comerciais",manager,async(req,res)=>{
 try{
  const collections=await sql.begin(async tx=>{
   await tx`SET TRANSACTION ISOLATION LEVEL REPEATABLE READ, READ ONLY`;
   const output={};
   for(const name of EXPORT_TABLES){
    const rows=await tx`SELECT * FROM ${tx(name)} ORDER BY id LIMIT ${ROW_LIMIT+1}`;
    if(rows.length>ROW_LIMIT)throw Error("LIMITE_EXPORTACAO");
    output[name]=rows;
   }
   return output;
  });
  const body=JSON.stringify({
   formato:"lajustore-exportacao-comercial-v1",
   exportado_em:new Date().toISOString(),
   contem_senhas:false,
   restauracao_automatica:false,
   observacao:"Cópia de consulta dos dados comerciais, não substitui pg_dump completo do PostgreSQL.",
   tabelas:collections
  },null,2);
  if(Buffer.byteLength(body,"utf8")>EXPORT_BYTES){
   return res.status(413).json({mensagem:"Arquivo acima do limite de segurança. Faça backup completo do PostgreSQL com pg_dump."});
  }
  res.set({
   "Cache-Control":"no-store, max-age=0",
   "Pragma":"no-cache",
   "X-Content-Type-Options":"nosniff",
   "Content-Type":"application/json; charset=utf-8",
   "Content-Disposition":`attachment; filename="lajustore-dados-${dateLocal()}.json"`
  });
  res.status(200).send(body);
 }catch(e){
  if(e.message==="LIMITE_EXPORTACAO")return res.status(413).json({
   mensagem:"A loja já possui muitos registros para exportação pelo painel. Faça um backup completo com pg_dump; nenhum arquivo incompleto foi gerado."
  });
  fail(res,e);
 }
});

export default router;
