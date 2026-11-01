import express from "express";
import sql from "./bd.js";
import {requireSession} from "./session.js";
const router=express.Router();
router.use(requireSession);
router.use(async(req,res,next)=>{
 try{
  const [u]=await sql`SELECT id,role,ativo FROM loja_usuarios WHERE id=${req.session.id}`;
  if(!u?.ativo)return res.status(401).json({mensagem:"Sessão expirada ou usuário inativo"});
  req.usuario=u;next();
 }catch(e){console.error("Autorização V7",e);res.status(500).json({mensagem:"Erro ao verificar sessão"});}
});
const gestor=(req,res,next)=>req.usuario.role==="gestor"?next():res.status(403).json({mensagem:"Somente administradores podem alterar estes dados"});
const id=v=>Number.isSafeInteger(Number(v))&&Number(v)>0?Number(v):null;
const money=v=>v!==null&&v!==undefined&&v!==""&&Number.isFinite(Number(v))&&Number(v)>=0&&Number(v)<=99999999?Math.round(Number(v)*100)/100:null;
const text=(v,max=200)=>typeof v==="string"?v.trim().slice(0,max):"";
const payments=["pix","dinheiro","credito","debito","outro"];
const channels=["loja","whatsapp","instagram"];
const fail=(res,e)=>{
 console.error("LajuStore V7",e);
 const known={
  PRODUTO_INVALIDO:[400,"Uma roupa do pedido não está disponível"],
  SEM_ESTOQUE:[409,"Estoque insuficiente para concluir este pedido"],
  PEDIDO_INVALIDO:[404,"Pedido não encontrado"],
  STATUS_INVALIDO:[409,"Pedido já concluído ou cancelado"],
  PEDIDO_VAZIO:[409,"Pedido sem peças"],
  DESCONTO_INVALIDO:[400,"Desconto maior que o total"]
 };
 if(known[e.message])return res.status(known[e.message][0]).json({mensagem:known[e.message][1]});
 if(e.code==="23503")return res.status(400).json({mensagem:"Cliente ou produto inválido"});
 if(e.code==="23505")return res.status(409).json({mensagem:"SKU ou variação já cadastrada"});
 return res.status(500).json({mensagem:"Falha na operação. Confira os logs do Render"});
};

// Pedidos pendentes não reservam itens: o estoque é validado novamente ao concluir.
router.get("/pendentes",async(req,res)=>{
 try{
  const rows=await sql`
   SELECT p.id,p.canal,p.criado_em,p.status,p.desconto,p.observacao,
    c.nome AS cliente,
    GREATEST(0,COALESCE(SUM(i.preco_unitario*i.quantidade),0)-p.desconto) AS total,
    COALESCE(json_agg(json_build_object(
      'variante_id',i.variante_id,'quantidade',i.quantidade,
      'preco_unitario',i.preco_unitario,'roupa',prod.nome,
      'tamanho',v.tamanho,'cor',v.cor
    ) ORDER BY i.id) FILTER (WHERE i.id IS NOT NULL),'[]'::json) AS itens
   FROM loja_pedidos p
   LEFT JOIN loja_clientes c ON c.id=p.cliente_id
   LEFT JOIN loja_pedido_itens i ON i.pedido_id=p.id
   LEFT JOIN loja_variantes v ON v.id=i.variante_id
   LEFT JOIN loja_produtos prod ON prod.id=v.produto_id
   WHERE p.status='rascunho'
   GROUP BY p.id,c.nome ORDER BY p.id DESC LIMIT 100`;
  res.json(rows);
 }catch(e){fail(res,e);}
});
router.post("/pendentes",async(req,res)=>{
 const {canal,cliente_id,itens,desconto,observacao}=req.body||{};
 const disc=money(desconto??0);
 if(!channels.includes(canal)||(cliente_id!=null&&!id(cliente_id))||disc===null||
   !Array.isArray(itens)||!itens.length||itens.length>80||
   itens.some(item=>!id(item.variante_id)||!id(item.quantidade)||id(item.quantidade)>100000)){
  return res.status(400).json({mensagem:"Verifique canal, peças, quantidades e desconto"});
 }
 const qtys=new Map();
 for(const item of itens){
  const key=id(item.variante_id);qtys.set(key,(qtys.get(key)||0)+id(item.quantidade));
 }
 if([...qtys.values()].some(q=>q>100000))return res.status(400).json({mensagem:"Quantidade inválida"});
 try{
  const created=await sql.begin(async tx=>{
   let subtotal=0;const lines=[];
   for(const [variantId,q] of [...qtys].sort((a,b)=>a[0]-b[0])){
    const [v]=await tx`SELECT v.id,v.quantidade AS saldo,p.preco,p.custo
      FROM loja_variantes v JOIN loja_produtos p ON p.id=v.produto_id
      WHERE v.id=${variantId} AND p.ativo=true`;
    if(!v)throw Error("PRODUTO_INVALIDO");
    if(Number(v.saldo)<q)throw Error("SEM_ESTOQUE");
    subtotal+=Number(v.preco)*q;
    lines.push({variantId,q,price:Number(v.preco),cost:v.custo==null?null:Number(v.custo)});
   }
   if(disc>Math.round(subtotal*100)/100)throw Error("DESCONTO_INVALIDO");
   const [order]=await tx`INSERT INTO loja_pedidos(cliente_id,canal,status,desconto,observacao,criado_por)
    VALUES(${cliente_id==null?null:id(cliente_id)},${canal},'rascunho',${disc},${text(observacao,600)||null},${req.usuario.id})
    RETURNING id,criado_em`;
   for(const line of lines)await tx`INSERT INTO loja_pedido_itens
    (pedido_id,variante_id,quantidade,preco_unitario,custo_unitario)
    VALUES(${order.id},${line.variantId},${line.q},${line.price},${line.cost})`;
   return {id:order.id,status:"rascunho",total:Math.round((subtotal-disc)*100)/100};
  });
  res.status(201).json(created);
 }catch(e){fail(res,e);}
});
router.post("/pendentes/:id/concluir",async(req,res)=>{
 const orderId=id(req.params.id),method=req.body?.forma_pagamento;
 if(!orderId||!payments.includes(method))return res.status(400).json({mensagem:"Pedido e forma de pagamento obrigatórios"});
 try{
  const result=await sql.begin(async tx=>{
   const [order]=await tx`SELECT * FROM loja_pedidos WHERE id=${orderId} FOR UPDATE`;
   if(!order)throw Error("PEDIDO_INVALIDO");
   if(order.status!=="rascunho")throw Error("STATUS_INVALIDO");
   const items=await tx`SELECT variante_id,SUM(quantidade)::int AS quantidade FROM loja_pedido_itens
    WHERE pedido_id=${orderId} GROUP BY variante_id ORDER BY variante_id`;
   if(!items.length)throw Error("PEDIDO_VAZIO");
   for(const item of items){
    const [v]=await tx`UPDATE loja_variantes SET quantidade=quantidade-${item.quantidade}
     WHERE id=${item.variante_id} AND quantidade>=${item.quantidade} RETURNING id`;
    if(!v)throw Error("SEM_ESTOQUE");
    await tx`INSERT INTO loja_movimentos(variante_id,pedido_id,diferenca,motivo)
     VALUES(${item.variante_id},${orderId},${-item.quantidade},'venda')`;
   }
   await tx`UPDATE loja_pedido_itens i SET custo_unitario=COALESCE(i.custo_unitario,p.custo)
     FROM loja_variantes v JOIN loja_produtos p ON p.id=v.produto_id
     WHERE i.pedido_id=${orderId} AND i.variante_id=v.id`;
   const [summary]=await tx`SELECT COALESCE(SUM(quantidade*preco_unitario),0) AS subtotal
     FROM loja_pedido_itens WHERE pedido_id=${orderId}`;
   const amount=Math.round((Number(summary.subtotal)-Number(order.desconto||0))*100)/100;
   if(amount<0)throw Error("DESCONTO_INVALIDO");
   await tx`UPDATE loja_pedidos SET status='pago',forma_pagamento=${method},
     finalizado_em=NOW() WHERE id=${orderId}`;
   if(amount>0)await tx`INSERT INTO loja_financeiro(tipo,categoria,descricao,valor,status,pedido_id,registrado_por)
    VALUES('entrada','vendas',${"Venda #"+orderId+" ("+method+")"},${amount},'pago',${orderId},${req.usuario.id})`;
   return {id:orderId,status:"pago",total:amount};
  });
  res.json(result);
 }catch(e){fail(res,e);}
});
router.post("/pendentes/:id/cancelar",gestor,async(req,res)=>{
 const orderId=id(req.params.id);
 if(!orderId)return res.status(400).json({mensagem:"Pedido inválido"});
 try{
  const result=await sql.begin(async tx=>{
   const [order]=await tx`SELECT id,status FROM loja_pedidos WHERE id=${orderId} FOR UPDATE`;
   if(!order)throw Error("PEDIDO_INVALIDO");
   if(order.status!=="rascunho")throw Error("STATUS_INVALIDO");
   await tx`UPDATE loja_pedidos SET status='cancelado' WHERE id=${orderId}`;
   return {id:orderId,status:"cancelado"};
  });
  res.json(result);
 }catch(e){fail(res,e);}
});
// Alteração de metadados, sem permitir editar saldos fora do histórico de movimentos.
router.patch("/variantes/:id",gestor,async(req,res)=>{
 const variantId=id(req.params.id);
 const {sku,tamanho,cor,minimo}=req.body||{};
 if(!variantId||!text(sku,80)||!text(tamanho,30)||!text(cor,80)||
  !Number.isSafeInteger(Number(minimo))||Number(minimo)<0||Number(minimo)>100000)
  return res.status(400).json({mensagem:"SKU, tamanho, cor e mínimo obrigatórios"});
 try{
  const [v]=await sql`UPDATE loja_variantes SET
   sku=${text(sku,80)},tamanho=${text(tamanho,30)},
   cor=${text(cor,80)},minimo=${Number(minimo)}
   WHERE id=${variantId} RETURNING id,sku,tamanho,cor,minimo,quantidade`;
  if(!v)return res.status(404).json({mensagem:"Variação não encontrada"});
  res.json(v);
 }catch(e){fail(res,e);}
});
export default router;
