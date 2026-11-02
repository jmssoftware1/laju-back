import express from "express";
import sql from "./bd.js";
import {requireSession} from "./session.js";

const router=express.Router();
const integerId=value=>Number.isSafeInteger(Number(value))&&Number(value)>0?Number(value):null;
const centavos=value=>Math.round(Number(value||0)*100);
const dataComercial=()=>new Intl.DateTimeFormat("en-CA",{
 timeZone:"America/Sao_Paulo",year:"numeric",month:"2-digit",day:"2-digit"
}).format(new Date());

router.use(requireSession);
router.use(async(req,res,next)=>{
 try{
  const [user]=await sql`SELECT id,role,ativo FROM loja_usuarios WHERE id=${req.session.id}`;
  if(!user?.ativo)return res.status(401).json({mensagem:"Sessão inválida. Entre novamente."});
  if(user.role!=="gestor")return res.status(403).json({
   mensagem:"Somente a administradora pode desfazer cancelamentos."
  });
  req.usuario=user;next();
 }catch(e){
  console.error("LajuStore reversão: autorização",e);
  res.status(500).json({mensagem:"Não foi possível verificar a autorização."});
 }
});

function handleError(res,e){
 const known={
  NAO_ENCONTRADO:[404,"Venda não encontrada."],
  STATUS_INVALIDO:[409,"A venda não está cancelada ou já foi restaurada. Atualize o histórico."],
  NAO_FOI_VENDA:[409,"Este registro era apenas um pedido pendente; não há venda paga para restaurar."],
  HISTORICO_INCONSISTENTE:[409,"O histórico de movimentações não permite uma reversão segura. Confira o estoque e procure o responsável técnico."],
  FINANCEIRO_INCONSISTENTE:[409,"O estorno financeiro da venda não corresponde ao valor esperado. Faça uma conferência antes de tentar novamente."],
  SEM_ESTOQUE:[409,"Não há peças suficientes no estoque para restaurar esta venda. Confira as quantidades disponíveis."],
  CREDIARIO_COM_PAGAMENTOS:[409,"Esta conta possui pagamentos registrados. Não é possível reativar automaticamente a venda."],
  CREDIARIO_INCONSISTENTE:[409,"A conta do cliente não está no estado esperado. Confira o histórico do crediário antes de restaurar."]
 };
 if(known[e.message])return res.status(known[e.message][0]).json({mensagem:known[e.message][1]});
 console.error("LajuStore reversão de cancelamento:",e);
 res.status(500).json({mensagem:"Não foi possível desfazer o cancelamento. Nenhuma alteração parcial foi gravada."});
}

// Restaura APENAS uma venda que esteve paga e foi cancelada.
// Não executa cobrança: a gestora confirma que não houve devolução real.
// Entrada da reversão compensa estorno contábil, NÃO um Pix recebido.
// Estoque, financeiro e auditoria usam uma única transação.
router.post("/vendas/:id/desfazer-cancelamento",async(req,res)=>{
 const pedidoId=integerId(req.params.id);
 const body=req.body||{};
 const motivo=typeof body.motivo==="string"?body.motivo.trim():"";
 if(!pedidoId)return res.status(400).json({mensagem:"Identificador de venda inválido."});
 if(motivo.length<8||motivo.length>240||body.confirmar_sem_devolucao!==true)
  return res.status(400).json({mensagem:"Informe o motivo (8 a 240 caracteres) e confirme que nenhum dinheiro foi realmente devolvido à cliente."});

 try{
  const output=await sql.begin(async tx=>{
   // Bloqueia concorrência e impede duas reversões do mesmo cancelamento.
   const [order]=await tx`
    SELECT id,status,forma_pagamento,origem_fluxo,desconto
    FROM loja_pedidos WHERE id=${pedidoId} FOR UPDATE`;
   if(!order)throw Error("NAO_ENCONTRADO");
   if(order.status!=="cancelado")throw Error("STATUS_INVALIDO");

   const items=await tx`
    SELECT variante_id,SUM(quantidade)::int AS quantidade
    FROM loja_pedido_itens
    WHERE pedido_id=${pedidoId}
    GROUP BY variante_id ORDER BY variante_id`;
   if(!items.length)throw Error("NAO_FOI_VENDA");

   const movementRows=await tx`
    SELECT variante_id,
      COALESCE(SUM(diferenca),0)::int AS saldo_movimentado,
      COUNT(*) FILTER (WHERE motivo='venda')::int AS vendas,
      COUNT(*) FILTER (WHERE motivo='cancelamento')::int AS cancelamentos,
      COUNT(*) FILTER (WHERE motivo NOT IN ('venda','cancelamento','reversao_cancelamento'))::int AS inesperados
    FROM loja_movimentos WHERE pedido_id=${pedidoId}
    GROUP BY variante_id`;
   const byVariant=new Map(movementRows.map(m=>[Number(m.variante_id),m]));
   if(items.some(item=>{
    const movement=byVariant.get(Number(item.variante_id));
    return !movement||movement.saldo_movimentado!==0||
      movement.vendas<1||movement.cancelamentos<1||movement.inesperados>0;
   })||movementRows.length!==items.length)throw Error("HISTORICO_INCONSISTENTE");

   const isCredit=order.forma_pagamento==="crediario";
   let creditId=null;
   let total=0;
   if(isCredit){
    const [credit]=await tx`
      SELECT id,status FROM loja_crediario
      WHERE pedido_id=${pedidoId} FOR UPDATE`;
    if(!credit||credit.status!=="cancelado")throw Error("CREDIARIO_INCONSISTENTE");
    const [paid]=await tx`
      SELECT COUNT(*)::int AS quantidade FROM loja_crediario_pagamentos
      WHERE crediario_id=${credit.id}`;
    if(paid.quantidade>0)throw Error("CREDIARIO_COM_PAGAMENTOS");
    creditId=credit.id;
   }else{
    const [sum]=await tx`
      SELECT GREATEST(0,COALESCE(SUM(quantidade*preco_unitario),0)-${Number(order.desconto)}) AS total
      FROM loja_pedido_itens WHERE pedido_id=${pedidoId}`;
    total=centavos(sum.total);

    const [ledger]=await tx`
      SELECT
       COALESCE(SUM(valor) FILTER (WHERE tipo='entrada'
         AND categoria IN ('vendas','reversao_estorno') AND status='pago'),0) AS entradas,
       COALESCE(SUM(valor) FILTER (WHERE tipo='saida'
         AND categoria='estorno' AND status='pago'),0) AS estornos,
       COUNT(*) FILTER (WHERE
         status<>'pago' OR
         NOT ((tipo='entrada' AND categoria IN ('vendas','reversao_estorno'))
          OR (tipo='saida' AND categoria='estorno'))
       )::int AS outros
      FROM loja_financeiro WHERE pedido_id=${pedidoId}`;
    const entries=centavos(ledger.entradas),refunds=centavos(ledger.estornos);
    if(ledger.outros>0 || entries-refunds!==0 ||
       (total>0&&(entries<total||refunds<total)) ||
       (total===0&&(entries!==0||refunds!==0)))
       throw Error("FINANCEIRO_INCONSISTENTE");
   }

   for(const item of items){
    const [updated]=await tx`
      UPDATE loja_variantes
      SET quantidade=quantidade-${item.quantidade}
      WHERE id=${item.variante_id} AND quantidade>=${item.quantidade}
      RETURNING id`;
    if(!updated)throw Error("SEM_ESTOQUE");
    await tx`INSERT INTO loja_movimentos(variante_id,pedido_id,diferenca,motivo)
      VALUES(${item.variante_id},${pedidoId},${-item.quantidade},'reversao_cancelamento')`;
   }

   await tx`UPDATE loja_pedidos SET status='pago' WHERE id=${pedidoId}`;
   if(isCredit){
    await tx`UPDATE loja_crediario SET status='aberto' WHERE id=${creditId}`;
   }else if(total>0){
    await tx`INSERT INTO loja_financeiro
      (tipo,categoria,descricao,valor,status,pedido_id,registrado_por,data_movimento)
      VALUES('entrada','reversao_estorno',
       ${"Reversão do estorno da venda #"+pedidoId+" (sem devolução real)"},
       ${total/100},'pago',${pedidoId},${req.usuario.id},${dataComercial()})`;
   }

   const details=JSON.stringify({
    motivo,confirmar_sem_devolucao:true,
    forma_pagamento:order.forma_pagamento,
    valor_compensado:total/100,
    tipo:"desfazer_cancelamento",
    detalhe:"Lançamento de reversão compensa o estorno contábil; nenhum Pix é recebido automaticamente."
   });
   await tx`INSERT INTO loja_auditoria_v7
     (usuario_id,entidade,registro_id,operacao,detalhes)
     VALUES(${req.usuario.id},'pedido',${pedidoId},'cancelamento_desfeito',${details}::jsonb)`;

   return {id:pedidoId,status:"pago",crediario_reaberto:isCredit,
    valor_compensado:total/100};
  });
  res.set("Cache-Control","no-store");
  res.json(output);
 }catch(e){handleError(res,e);}
});

export default router;
