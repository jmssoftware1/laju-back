import express from "express";
import sql from "./bd.js";
import {requireSession} from "./session.js";

const router=express.Router();
const money=value=>{
 if(value===""||value===null||value===undefined||!Number.isFinite(Number(value))||
    Number(value)<=0||Number(value)>99999999||Math.round(Number(value)*100)!==Number(value)*100)return null;
 return Math.round(Number(value)*100);
};
const id=value=>Number.isSafeInteger(Number(value))&&Number(value)>0?Number(value):null;
const cents=value=>Math.round(Number(value||0)*100);
const localeDate=()=>new Intl.DateTimeFormat("en-CA",{
 timeZone:"America/Sao_Paulo",year:"numeric",month:"2-digit",day:"2-digit"
}).format(new Date());
const humanError=(res,e)=>{
 if(["QUITADO","CANCELADO","SALDO_INSUFICIENTE","PAGAMENTO_INVALIDO"].includes(e.message)){
  return res.status(409).json({mensagem:{
   QUITADO:"A conta já foi quitada.",
   CANCELADO:"A conta foi cancelada.",
   SALDO_INSUFICIENTE:"O pagamento informado é maior que o saldo em aberto.",
   PAGAMENTO_INVALIDO:"Não é possível registrar esse pagamento."
  }[e.message]});
 }
 if(e.message==="NAO_ENCONTRADO")return res.status(404).json({mensagem:"Conta não encontrada."});
 console.error("LajuStore crediário:",e);
 return res.status(500).json({mensagem:"Não foi possível concluir a operação do crediário. Confirme a migração SQL 004."});
};
router.use(requireSession);
router.use(async(req,res,next)=>{
 try{
  const [user]=await sql`SELECT id,role,ativo FROM loja_usuarios WHERE id=${req.session.id}`;
  if(!user?.ativo)return res.status(401).json({mensagem:"Sessão inválida. Entre novamente."});
  if(user.role!=="gestor")return res.status(403).json({mensagem:"Apenas a administradora pode consultar e registrar contas de clientes."});
  req.usuario=user;next();
 }catch(e){humanError(res,e);}
});

const asDate=value=>{
 if(value instanceof Date)return value.toISOString().slice(0,10);
 if(typeof value==="string")return value.slice(0,10);
 return "";
};

// Concilia parcelas por ordem de vencimento. Cálculos sempre em centavos.
async function detailFor(rows){
 if(!rows.length)return [];
 const ids=rows.map(r=>Number(r.id));
 const [scheduled,receipts]=await Promise.all([
  sql`SELECT crediario_id,numero,valor,vencimento
      FROM loja_crediario_parcelas
      WHERE crediario_id IN ${sql(ids)}
      ORDER BY crediario_id,numero`,
  sql`SELECT id,crediario_id,valor,forma_pagamento,observacao,recebido_em
      FROM loja_crediario_pagamentos
      WHERE crediario_id IN ${sql(ids)}
      ORDER BY crediario_id,recebido_em,id`
 ]);
 const paymentsBy=new Map(),parcelsBy=new Map();
 for(const p of scheduled){const key=Number(p.crediario_id);if(!parcelsBy.has(key))parcelsBy.set(key,[]);parcelsBy.get(key).push(p);}
 for(const p of receipts){const key=Number(p.crediario_id);if(!paymentsBy.has(key))paymentsBy.set(key,[]);paymentsBy.get(key).push(p);}
 const today=localeDate();
 return rows.map(row=>{
  const creditId=Number(row.id);
  const received=paymentsBy.get(creditId)||[];
  const totalPaid=received.reduce((sum,r)=>sum+cents(r.valor),0);
  let remainingPaid=totalPaid;
  const parcels=(parcelsBy.get(creditId)||[]).map(part=>{
   const value=cents(part.valor);
   const allocated=Math.min(value,remainingPaid);
   remainingPaid-=allocated;
   return {numero:part.numero,valor:value/100,vencimento:asDate(part.vencimento),
    pago:allocated/100,saldo:(value-allocated)/100,
    situacao:allocated>=value?"quitada":asDate(part.vencimento)<today?"atrasada":"em_aberto"};
  });
  const open=Math.max(0,cents(row.total)-totalPaid);
  const next=parcels.find(p=>p.saldo>0);
  return {id:creditId,pedido_id:Number(row.pedido_id),cliente_id:Number(row.cliente_id),
   cliente:row.cliente,canal:row.canal,criado_em:row.criado_em,
   observacao:row.observacao||"",status:row.status,total:cents(row.total)/100,
   recebido:totalPaid/100,saldo:open/100,vencimento_proximo:next?.vencimento||null,
   atrasado:row.status==="aberto"&&parcels.some(p=>p.situacao==="atrasada"),
   parcelas:parcels,
   pagamentos:received.map(p=>({
    id:Number(p.id),valor:cents(p.valor)/100,forma_pagamento:p.forma_pagamento,
    observacao:p.observacao||"",recebido_em:p.recebido_em
   }))};
 });
}
const baseRows=async(clientId=null,all=false)=>{
 const rows=await sql`
  SELECT cr.id,cr.pedido_id,cr.cliente_id,cr.total,cr.status,
         cr.observacao,cr.criado_em,cl.nome AS cliente,p.canal
    FROM loja_crediario cr
    JOIN loja_clientes cl ON cl.id=cr.cliente_id
    JOIN loja_pedidos p ON p.id=cr.pedido_id
   WHERE (${clientId}::bigint IS NULL OR cr.cliente_id=${clientId})
     AND (${all} OR cr.status='aberto')
   ORDER BY cr.id DESC LIMIT 500`;
 return detailFor(rows);
};

router.get("/resumo",async(_req,res)=>{
 try{
  const [summary]=await sql`
   WITH totals AS (
    SELECT c.id,c.cliente_id,c.total,
      COALESCE((SELECT SUM(p.valor) FROM loja_crediario_pagamentos p WHERE p.crediario_id=c.id),0) AS recebido
    FROM loja_crediario c WHERE c.status='aberto'
   )
   SELECT COUNT(*)::int AS contas,
     COUNT(DISTINCT cliente_id)::int AS clientes,
     COALESCE(SUM(total-recebido),0) AS saldo
   FROM totals`;
  res.set("Cache-Control","no-store");
  res.json({contas:summary.contas,clientes:summary.clientes,saldo:Number(summary.saldo)});
 }catch(e){humanError(res,e);}
});
router.get("/",async(req,res)=>{
 const customer=req.query.cliente_id===undefined?null:id(req.query.cliente_id);
 if(req.query.cliente_id!==undefined&&!customer)return res.status(400).json({mensagem:"Cliente inválido."});
 const all=req.query.situacao==="todas";
 if(req.query.situacao&& !["aberto","todas"].includes(req.query.situacao))return res.status(400).json({mensagem:"Filtro inválido."});
 try{
  const result=await baseRows(customer,all);
  res.set("Cache-Control","no-store");
  res.json(result);
 }catch(e){humanError(res,e);}
});
router.get("/:id",async(req,res)=>{
 const creditId=id(req.params.id);
 if(!creditId)return res.status(400).json({mensagem:"Conta inválida."});
 try{
  const [row]=await sql`
    SELECT cr.id,cr.pedido_id,cr.cliente_id,cr.total,cr.status,
           cr.observacao,cr.criado_em,cl.nome AS cliente,p.canal
    FROM loja_crediario cr JOIN loja_clientes cl ON cl.id=cr.cliente_id
    JOIN loja_pedidos p ON p.id=cr.pedido_id
    WHERE cr.id=${creditId}`;
  if(!row)return res.status(404).json({mensagem:"Conta não encontrada."});
  const [detail]=await detailFor([row]);
  res.set("Cache-Control","no-store");res.json(detail);
 }catch(e){humanError(res,e);}
});

// Pagamentos parciais entram no caixa uma vez e na mesma transação.
// A chave da operação impede duplicar um recebimento ao tentar novamente.
router.post("/:id/pagamentos",async(req,res)=>{
 const creditId=id(req.params.id),q=req.body||{};
 const value=money(q.valor);
 const key=typeof q.chave_operacao==="string"?q.chave_operacao.trim():"";
 const method=q.forma_pagamento;
 const note=typeof q.observacao==="string"?q.observacao.trim().slice(0,240):"";
 if(!creditId||value===null||value<1||
    !["pix","dinheiro","debito","credito","outro"].includes(method)||
    !/^[a-zA-Z0-9_-]{10,100}$/.test(key)||
    (q.observacao!==undefined&&typeof q.observacao!=="string"))
   return res.status(400).json({mensagem:"Confira a conta, o valor, a forma de pagamento e tente novamente."});
 try{
  const result=await sql.begin(async tx=>{
   const [credit]=await tx`SELECT id,pedido_id,total,status FROM loja_crediario WHERE id=${creditId} FOR UPDATE`;
   if(!credit)throw Error("NAO_ENCONTRADO");
   // Reenvio idempotente não cria outra entrada no caixa.
   const [old]=await tx`SELECT id,crediario_id,valor,forma_pagamento FROM loja_crediario_pagamentos
    WHERE chave_operacao=${key}`;
   if(old){
    if(Number(old.crediario_id)!==creditId||cents(old.valor)!==value||old.forma_pagamento!==method)
     throw Error("PAGAMENTO_INVALIDO");
    return {id:Number(old.id),repetido:true};
   }
   if(credit.status==="cancelado")throw Error("CANCELADO");
   if(credit.status==="quitado")throw Error("QUITADO");
   const [pay]=await tx`SELECT COALESCE(SUM(valor),0) AS total
     FROM loja_crediario_pagamentos WHERE crediario_id=${creditId}`;
   const remain=cents(credit.total)-cents(pay.total);
   if(value>remain)throw Error("SALDO_INSUFICIENTE");
   const [ledger]=await tx`INSERT INTO loja_financeiro
     (tipo,categoria,descricao,valor,status,pedido_id,registrado_por,data_movimento)
     VALUES('entrada','crediario',${"Recebimento crediário #"+creditId+" (venda #"+credit.pedido_id+", "+method+")"},
        ${value/100},'pago',${credit.pedido_id},${req.usuario.id},${localeDate()})
     RETURNING id`;
   const [receipt]=await tx`INSERT INTO loja_crediario_pagamentos
     (crediario_id,valor,forma_pagamento,observacao,chave_operacao,registrado_por,financeiro_id)
     VALUES(${creditId},${value/100},${method},${note||null},${key},${req.usuario.id},${ledger.id})
     RETURNING id`;
   if(value===remain)await tx`UPDATE loja_crediario SET status='quitado' WHERE id=${creditId}`;
   return {id:Number(receipt.id),repetido:false,saldo:(remain-value)/100};
  });
  res.set("Cache-Control","no-store");
  res.status(result.repetido?200:201).json(result);
 }catch(e){
  if(e.code==="23505")return res.status(409).json({mensagem:"Pagamento já registrado; atualize a conta antes de repetir."});
  humanError(res,e);
 }
});

export default router;
