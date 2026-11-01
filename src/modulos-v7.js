import express from "express";
import sql from "./bd.js";
import {requireSession} from "./session.js";
import {
  idValido, centavos, texto, validarPendente, validarVariacao, PAGAMENTOS
} from "./v7-validacao.js";

const router = express.Router();
router.use(requireSession);
router.use(async (req,res,next)=>{
  try {
    const [u] = await sql`SELECT id,role,ativo FROM loja_usuarios WHERE id=${req.session.id}`;
    if (!u?.ativo) return res.status(401).json({mensagem:"Sessão inválida. Entre novamente."});
    req.usuario = u;
    next();
  } catch (e) {
    console.error("V7 authorization:",e);
    res.status(500).json({mensagem:"Falha na autorização"});
  }
});
const apenasGestor = (req,res,next)=>req.usuario.role === "gestor"
  ? next() : res.status(403).json({mensagem:"Apenas a administradora pode realizar esta operação"});

function responderErro(res,e){
  console.error("LajuStore V7:",e);
  if (e?.code === "23505") return res.status(409).json({mensagem:"SKU ou variação já cadastrados"});
  if (e?.code === "23503") return res.status(400).json({mensagem:"Cliente ou peça inválida"});
  if (["SEM_ESTOQUE","NAO_PENDENTE"].includes(e?.message))
    return res.status(409).json({mensagem:e.message === "SEM_ESTOQUE"
      ? "O estoque ficou insuficiente. Confirme as quantidades antes de concluir."
      : "Este pedido não está mais aguardando pagamento."});
  if (e?.message === "DESCONTO") return res.status(400).json({mensagem:"Desconto maior que o total do pedido"});
  if (e?.message === "ITEM_INVALIDO") return res.status(400).json({mensagem:"Uma roupa não está disponível"});
  if (e?.message === "INEXISTENTE") return res.status(404).json({mensagem:"Pedido não encontrado"});
  return res.status(500).json({mensagem:"Não foi possível concluir. Confira se a migração V7 foi executada."});
}

router.get("/pendentes",async(req,res)=>{
  try {
    const result = await sql`
      SELECT p.id,p.canal,p.criado_em,p.desconto,p.observacao,c.nome AS cliente,
        GREATEST(0,COALESCE(SUM(i.quantidade*i.preco_unitario),0)-p.desconto) AS total,
        COALESCE(
          json_agg(json_build_object(
            'roupa',prod.nome,'tamanho',v.tamanho,'cor',v.cor,
            'quantidade',i.quantidade,'preco_unitario',i.preco_unitario
          ) ORDER BY i.id) FILTER (WHERE i.id IS NOT NULL),
          '[]'::json
        ) AS itens
      FROM loja_pedidos p
      LEFT JOIN loja_clientes c ON c.id=p.cliente_id
      LEFT JOIN loja_pedido_itens i ON i.pedido_id=p.id
      LEFT JOIN loja_variantes v ON v.id=i.variante_id
      LEFT JOIN loja_produtos prod ON prod.id=v.produto_id
      WHERE p.status='rascunho' AND p.origem_fluxo='v7_pendente'
      GROUP BY p.id,c.nome
      ORDER BY p.criado_em DESC,p.id DESC
      LIMIT 150`;
    res.json(result);
  } catch (e) { responderErro(res,e); }
});

router.post("/pendentes",async(req,res)=>{
  const parsed = validarPendente(req.body);
  if (!parsed.ok) return res.status(400).json({mensagem:parsed.mensagem});
  const p=parsed.pedido;
  try{
    const order = await sql.begin(async tx=>{
      const resolved=[];
      let subtotal=0;
      for(const item of p.itens) {
        const [v]=await tx`
          SELECT v.id,v.quantidade,prod.preco,prod.custo
          FROM loja_variantes v JOIN loja_produtos prod ON prod.id=v.produto_id
          WHERE v.id=${item.variante_id} AND prod.ativo=true`;
        if (!v) throw Error("ITEM_INVALIDO");
        if (v.quantidade < item.quantidade) throw Error("SEM_ESTOQUE");
        const unitCents=centavos(v.preco);
        if(unitCents===null)throw Error("ITEM_INVALIDO");
        subtotal += unitCents*item.quantidade;
        if (!Number.isSafeInteger(subtotal))throw Error("ITEM_INVALIDO");
        resolved.push({...item,preco:unitCents/100,custo:v.custo===null?null:Number(v.custo)});
      }
      if(p.desconto_centavos>subtotal)throw Error("DESCONTO");
      const [created]=await tx`
        INSERT INTO loja_pedidos(
          cliente_id,canal,status,desconto,observacao,criado_por,origem_fluxo)
        VALUES(${p.cliente_id},${p.canal},'rascunho',${p.desconto_centavos/100},
          ${p.observacao},${req.usuario.id},'v7_pendente')
        RETURNING id,canal,status`;
      for(const item of resolved){
        await tx`
          INSERT INTO loja_pedido_itens(pedido_id,variante_id,quantidade,preco_unitario,custo_unitario)
          VALUES(${created.id},${item.variante_id},${item.quantidade},${item.preco},${item.custo})`;
      }
      const detalhes=JSON.stringify({canal:p.canal,quantidade_itens:resolved.length});
      await tx`
        INSERT INTO loja_auditoria_v7(usuario_id,entidade,registro_id,operacao,detalhes)
        VALUES(${req.usuario.id},'pedido',${created.id},'criado_pendente',${detalhes}::jsonb)`;
      return {...created,total: (subtotal-p.desconto_centavos)/100};
    });
    res.status(201).json(order);
  } catch(e){responderErro(res,e);}
});

router.post("/pendentes/:id/concluir",async(req,res)=>{
  const pedidoId = idValido(req.params.id);
  const pagamento = req.body?.forma_pagamento;
  if (!pedidoId || !PAGAMENTOS.has(pagamento))
    return res.status(400).json({mensagem:"Informe pedido e forma de pagamento válida"});
  try {
    const result = await sql.begin(async tx=>{
      const [p]=await tx`
        SELECT * FROM loja_pedidos WHERE id=${pedidoId} FOR UPDATE`;
      if (!p || p.origem_fluxo !== "v7_pendente")throw Error("INEXISTENTE");
      if (p.status === "pago") return {id:p.id,status:"pago",ja_concluido:true};
      if (p.status !== "rascunho")throw Error("NAO_PENDENTE");

      const itens=await tx`
        SELECT variante_id,quantidade,preco_unitario
        FROM loja_pedido_itens WHERE pedido_id=${pedidoId}
        ORDER BY variante_id`;
      if (!itens.length)throw Error("ITEM_INVALIDO");
      let subtotalCentavos=0;
      for (const i of itens){
        const cents=centavos(i.preco_unitario);
        if (cents===null)throw Error("ITEM_INVALIDO");
        subtotalCentavos+=cents*i.quantidade;
      }
      const descontoCentavos=centavos(p.desconto);
      if (descontoCentavos===null || descontoCentavos>subtotalCentavos)throw Error("DESCONTO");
      const total=(subtotalCentavos-descontoCentavos)/100;

      for(const item of itens){
        const [v]=await tx`
          UPDATE loja_variantes SET quantidade=quantidade-${item.quantidade}
          WHERE id=${item.variante_id} AND quantidade>=${item.quantidade}
          RETURNING id`;
        if (!v)throw Error("SEM_ESTOQUE");
        await tx`
          INSERT INTO loja_movimentos(variante_id,pedido_id,diferenca,motivo)
          VALUES(${item.variante_id},${pedidoId},${-item.quantidade},'venda')`;
      }
      await tx`
        UPDATE loja_pedidos
        SET status='pago',forma_pagamento=${pagamento},finalizado_em=NOW()
        WHERE id=${pedidoId}`;
      if (total>0){
        await tx`
          INSERT INTO loja_financeiro(tipo,categoria,descricao,valor,status,pedido_id,registrado_por)
          VALUES('entrada','vendas',${"Venda #"+pedidoId+" ("+pagamento+")"},
            ${total},'pago',${pedidoId},${req.usuario.id})`;
      }
      const details=JSON.stringify({forma_pagamento:pagamento,total});
      await tx`
        INSERT INTO loja_auditoria_v7(usuario_id,entidade,registro_id,operacao,detalhes)
        VALUES(${req.usuario.id},'pedido',${pedidoId},'confirmado',${details}::jsonb)`;
      return {id:pedidoId,status:"pago",total};
    });
    res.json(result);
  }catch(e){responderErro(res,e);}
});

router.post("/pendentes/:id/cancelar",apenasGestor,async(req,res)=>{
  const pedidoId=idValido(req.params.id);
  if(!pedidoId)return res.status(400).json({mensagem:"Pedido inválido"});
  try {
    const result=await sql.begin(async tx=>{
      const [p]=await tx`SELECT id,status,origem_fluxo FROM loja_pedidos WHERE id=${pedidoId} FOR UPDATE`;
      if(!p || p.origem_fluxo!=="v7_pendente")throw Error("INEXISTENTE");
      if(p.status === "cancelado")return {id:pedidoId,status:"cancelado",ja_cancelado:true};
      if(p.status!=="rascunho")throw Error("NAO_PENDENTE");
      await tx`UPDATE loja_pedidos SET status='cancelado' WHERE id=${pedidoId}`;
      await tx`
        INSERT INTO loja_auditoria_v7(usuario_id,entidade,registro_id,operacao,detalhes)
        VALUES(${req.usuario.id},'pedido',${pedidoId},'cancelado','{}'::jsonb)`;
      return {id:pedidoId,status:"cancelado"};
    });
    res.json(result);
  }catch(e){responderErro(res,e);}
});

router.patch("/variantes/:id",apenasGestor,async(req,res)=>{
  const variantId=idValido(req.params.id);
  const parsed=validarVariacao(req.body);
  if (!variantId || !parsed.ok)return res.status(400).json({mensagem:parsed.mensagem||"Variação inválida"});
  const v=parsed.variacao;
  try{
    const result=await sql.begin(async tx=>{
      const [old]=await tx`
        SELECT id,sku,tamanho,cor,minimo,quantidade FROM loja_variantes
        WHERE id=${variantId} FOR UPDATE`;
      if(!old)throw Error("INEXISTENTE");
      const [updated]=await tx`
        UPDATE loja_variantes SET sku=${v.sku},tamanho=${v.tamanho},
          cor=${v.cor},minimo=${v.minimo}
        WHERE id=${variantId}
        RETURNING id,sku,tamanho,cor,minimo,quantidade`;
      const details=JSON.stringify({antes:old,depois:updated});
      await tx`
        INSERT INTO loja_auditoria_v7(usuario_id,entidade,registro_id,operacao,detalhes)
        VALUES(${req.usuario.id},'variante',${variantId},'editada',${details}::jsonb)`;
      return updated;
    });
    res.json(result);
  }catch(e){responderErro(res,e);}
});

export default router;
