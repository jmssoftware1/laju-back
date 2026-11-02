import express from "express";
import bcrypt from "bcrypt";
import sql from "./bd.js";
import { requireSession } from "./session.js";

const router = express.Router();
const dataComercial = () => new Intl.DateTimeFormat("en-CA", {timeZone:"America/Sao_Paulo",year:"numeric",month:"2-digit",day:"2-digit"}).format(new Date());
router.use(requireSession);
router.use(async (req, res, next) => {
  try {
    const [user] = await sql`SELECT id, nome, role, ativo FROM loja_usuarios WHERE id=${req.session.id}`;
    if (!user?.ativo) return res.status(401).json({ mensagem: "Sessão inválida. Entre novamente." });
    req.usuario = user;
    next();
  } catch (e) { console.error("autorização V6:", e); res.status(500).json({ mensagem: "Falha de autenticação" }); }
});
const gestor = (req, res, next) => req.usuario.role === "gestor" ? next() : res.status(403).json({ mensagem: "Apenas a administradora pode realizar esta operação" });
const erro = (res, e) => {
  console.error("LajuStore V6:", e);
  if (e.code === "23505") return res.status(409).json({ mensagem: "Registro ou código já cadastrado" });
  if (e.code === "23503") return res.status(400).json({ mensagem: "Referência inválida" });
  if (e.message === "SEM_ESTOQUE") return res.status(409).json({ mensagem: "Estoque insuficiente para essa venda" });
  if (e.message === "INEXISTENTE") return res.status(404).json({ mensagem: "Registro não encontrado" });
  if (e.message === "STATUS_INVALIDO") return res.status(409).json({ mensagem: "Este pedido não pode ser alterado" });
  if (e.message === "ITEM_INVALIDO") return res.status(400).json({ mensagem: "Uma peça selecionada não existe" });
  return res.status(500).json({ mensagem: "Erro no servidor. Confira se a migração V6 foi executada." });
};
const str = (v, max=180) => typeof v === "string" ? v.trim().slice(0,max) : "";
const id = v => Number.isSafeInteger(Number(v)) && Number(v) > 0 ? Number(v) : null;
const natural = v => Number.isSafeInteger(Number(v)) && Number(v) >= 0 ? Number(v) : null;
const valor = v => v !== "" && v !== null && v !== undefined && Number.isFinite(Number(v)) && Number(v) >= 0 && Number(v) <= 99999999 ? Math.round(Number(v)*100)/100 : null;
const okDate = s => typeof s === "string" && /^\d{4}-\d{2}-\d{2}$/.test(s) && !Number.isNaN(Date.parse(s)) ? s : null;
const validVariant = (v) => str(v?.sku,80) && str(v?.tamanho,30) && str(v?.cor,80) && natural(v?.quantidade)!==null && natural(v?.minimo ?? 0)!==null;

// PRODUTOS E ESTOQUE
router.post("/produtos", async (req,res) => {
  const { nome, categoria, descricao, preco, custo, variantes } = req.body || {};
  if (!str(nome) || valor(preco)===null || (custo != null && custo !== "" && valor(custo)===null) || !Array.isArray(variantes) || !variantes.length || variantes.length>60 || variantes.some(v => !validVariant(v)))
    return res.status(400).json({mensagem:"Confira o nome, preço e variações da roupa"});
  const keys = variantes.map(v=>`${str(v.tamanho).toLowerCase()}|${str(v.cor).toLowerCase()}`);
  if (new Set(keys).size !== keys.length || new Set(variantes.map(v=>str(v.sku))).size !== variantes.length)
    return res.status(400).json({mensagem:"Tamanhos, cores ou SKUs repetidos"});
  try {
    const produto = await sql.begin(async tx => {
      const [p] = await tx`INSERT INTO loja_produtos(nome,categoria,descricao,preco,custo)
        VALUES(${str(nome)},${str(categoria,80)||null},${str(descricao,1200)||null},${valor(preco)},${custo==null||custo===""?null:valor(custo)}) RETURNING id`;
      for (const v of variantes) {
        const [item] = await tx`INSERT INTO loja_variantes(produto_id,sku,tamanho,cor,quantidade,minimo)
          VALUES(${p.id},${str(v.sku,80)},${str(v.tamanho,30)},${str(v.cor,80)},${natural(v.quantidade)},${natural(v.minimo??0)}) RETURNING id`;
        if (Number(v.quantidade)>0) await tx`INSERT INTO loja_movimentos(variante_id,diferenca,motivo)
          VALUES(${item.id},${natural(v.quantidade)},'estoque_inicial')`;
      }
      return p;
    });
    res.status(201).json(produto);
  } catch (e) { erro(res,e); }
});
router.patch("/produtos/:id", gestor, async (req,res) => {
  if (!id(req.params.id)) return res.status(400).json({mensagem:"Produto inválido"});
  const {nome,categoria,descricao,preco,custo,ativo} = req.body||{};
  if (!str(nome) || valor(preco)===null || (custo !== null && custo !== "" && custo !== undefined && valor(custo)===null) || typeof ativo!=="boolean") return res.status(400).json({mensagem:"Dados inválidos"});
  try {
    const [p] = await sql`UPDATE loja_produtos SET nome=${str(nome)}, categoria=${str(categoria,80)||null},
      descricao=${str(descricao,1200)||null},preco=${valor(preco)},custo=${custo==null||custo===""?null:valor(custo)},ativo=${ativo}
      WHERE id=${id(req.params.id)} RETURNING id`;
    if (!p) return res.status(404).json({mensagem:"Produto não encontrado"});
    res.json(p);
  } catch(e){erro(res,e);}
});
router.post("/produtos/:id/variantes", async (req,res) => {
  const produtoId=id(req.params.id),v=req.body||{};
  if (!produtoId || !validVariant(v)) return res.status(400).json({mensagem:"Variação inválida"});
  try{
    const result=await sql.begin(async tx=>{
      const [p]=await tx`SELECT id FROM loja_produtos WHERE id=${produtoId} AND ativo=true`;
      if(!p) throw Error("INEXISTENTE");
      const [item]=await tx`INSERT INTO loja_variantes(produto_id,sku,tamanho,cor,quantidade,minimo)
        VALUES(${produtoId},${str(v.sku,80)},${str(v.tamanho,30)},${str(v.cor,80)},${natural(v.quantidade)},${natural(v.minimo??0)}) RETURNING id`;
      if(Number(v.quantidade)>0) await tx`INSERT INTO loja_movimentos(variante_id,diferenca,motivo) VALUES(${item.id},${natural(v.quantidade)},'estoque_inicial')`;
      return item;
    });
    res.status(201).json(result);
  }catch(e){erro(res,e);}
});
router.patch("/variantes/:id", gestor, async(req,res)=>{
  const variantId=id(req.params.id), {minimo,sku}=req.body||{};
  if(!variantId || natural(minimo)===null || !str(sku,80)) return res.status(400).json({mensagem:"Variação inválida"});
  try{const [v]=await sql`UPDATE loja_variantes SET minimo=${natural(minimo)},sku=${str(sku,80)} WHERE id=${variantId} RETURNING *`;
    if(!v)return res.status(404).json({mensagem:"Variação não encontrada"}); res.json(v);
  }catch(e){erro(res,e);}
});
router.post("/variantes/:id/ajuste", gestor, async(req,res)=>{
  const variantId=id(req.params.id),delta=Number(req.body?.diferenca),motivo=str(req.body?.motivo,140);
  if(!variantId || !Number.isSafeInteger(delta) || delta===0 || Math.abs(delta)>100000 || !motivo) return res.status(400).json({mensagem:"Informe quantidade positiva ou negativa e motivo"});
  try{
    const result=await sql.begin(async tx=>{
      const [v]=await tx`UPDATE loja_variantes SET quantidade=quantidade+${delta}
        WHERE id=${variantId} AND quantidade+${delta}>=0 RETURNING id,quantidade`;
      if(!v) throw Error("SEM_ESTOQUE");
      await tx`INSERT INTO loja_movimentos(variante_id,diferenca,motivo) VALUES(${variantId},${delta},${motivo})`;
      return v;
    });
    res.json(result);
  }catch(e){erro(res,e);}
});
router.get("/movimentos",async(req,res)=>{
 try{const rows=await sql`SELECT m.id,m.criado_em,m.diferenca,m.motivo,m.pedido_id,p.nome,v.sku,v.tamanho,v.cor
   FROM loja_movimentos m JOIN loja_variantes v ON v.id=m.variante_id JOIN loja_produtos p ON p.id=v.produto_id
   ORDER BY m.id DESC LIMIT 100`;res.json(rows);}
 catch(e){erro(res,e);}
});

// CLIENTES
router.patch("/clientes/:id",async(req,res)=>{
 const clienteId=id(req.params.id),{nome,telefone,instagram}=req.body||{};
 if(!clienteId||!str(nome))return res.status(400).json({mensagem:"Nome obrigatório"});
 try{const [c]=await sql`UPDATE loja_clientes SET nome=${str(nome)},telefone=${str(telefone,60)||null},instagram=${str(instagram,100)||null}
 WHERE id=${clienteId} RETURNING *`;if(!c)return res.status(404).json({mensagem:"Cliente não encontrado"});res.json(c);}
 catch(e){erro(res,e);}
});
router.get("/clientes/:id/compras",async(req,res)=>{
 if(!id(req.params.id))return res.status(400).json({mensagem:"Cliente inválido"});
 try{res.json(await sql`SELECT p.id,p.criado_em,p.canal,p.status, GREATEST(0,COALESCE(SUM(i.preco_unitario*i.quantidade),0)-p.desconto) AS total
 FROM loja_pedidos p LEFT JOIN loja_pedido_itens i ON i.pedido_id=p.id
 WHERE p.cliente_id=${id(req.params.id)} GROUP BY p.id ORDER BY p.id DESC LIMIT 50`);}
 catch(e){erro(res,e);}
});

// FORNECEDORES E COMPRAS
router.get("/fornecedores",async(req,res)=>{
 try{res.json(await sql`SELECT * FROM loja_fornecedores WHERE ativo=true ORDER BY nome LIMIT 500`);}
 catch(e){erro(res,e);}
});
router.post("/fornecedores",gestor,async(req,res)=>{
 const {nome,telefone,email,observacao}=req.body||{};
 if(!str(nome))return res.status(400).json({mensagem:"Nome obrigatório"});
 try{const [f]=await sql`INSERT INTO loja_fornecedores(nome,telefone,email,observacao)
 VALUES(${str(nome)},${str(telefone,60)||null},${str(email,120)||null},${str(observacao,600)||null}) RETURNING *`;res.status(201).json(f);}
 catch(e){erro(res,e);}
});
router.patch("/fornecedores/:id",gestor,async(req,res)=>{
 const fId=id(req.params.id),{nome,telefone,email,observacao,ativo}=req.body||{};
 if(!fId||!str(nome)||typeof ativo!=="boolean")return res.status(400).json({mensagem:"Fornecedor inválido"});
 try{const [f]=await sql`UPDATE loja_fornecedores SET nome=${str(nome)},telefone=${str(telefone,60)||null},email=${str(email,120)||null},observacao=${str(observacao,600)||null},ativo=${ativo} WHERE id=${fId} RETURNING *`;
 if(!f)return res.status(404).json({mensagem:"Fornecedor não encontrado"});res.json(f);}
 catch(e){erro(res,e);}
});
router.get("/compras",gestor,async(req,res)=>{
 try{res.json(await sql`SELECT c.*,f.nome AS fornecedor FROM loja_compras c LEFT JOIN loja_fornecedores f ON f.id=c.fornecedor_id ORDER BY c.id DESC LIMIT 100`);}
 catch(e){erro(res,e);}
});
router.post("/compras",gestor,async(req,res)=>{
 const {fornecedor_id,observacao,itens}=req.body||{};
 if((fornecedor_id!=null&&!id(fornecedor_id))||!Array.isArray(itens)||!itens.length||itens.length>100||
  itens.some(i=>!id(i.variante_id)||!id(i.quantidade)||valor(i.custo_unitario)===null))return res.status(400).json({mensagem:"Compra inválida"});
 try{
  const total=itens.reduce((t,i)=>t+Number(i.quantidade)*valor(i.custo_unitario),0);
  if(!Number.isFinite(total)||total>99999999)return res.status(400).json({mensagem:"Valor acima do limite"});
  const compra=await sql.begin(async tx=>{
   const [c]=await tx`INSERT INTO loja_compras(fornecedor_id,observacao,total,registrado_por)
    VALUES(${fornecedor_id?id(fornecedor_id):null},${str(observacao,600)||null},${Math.round(total*100)/100},${req.usuario.id}) RETURNING *`;
   for(const item of [...itens].sort((a,b)=>Number(a.variante_id)-Number(b.variante_id))){
    const [v]=await tx`UPDATE loja_variantes SET quantidade=quantidade+${id(item.quantidade)}
     WHERE id=${id(item.variante_id)} RETURNING id`;
    if(!v)throw Error("ITEM_INVALIDO");
    await tx`INSERT INTO loja_compra_itens(compra_id,variante_id,quantidade,custo_unitario)
      VALUES(${c.id},${v.id},${id(item.quantidade)},${valor(item.custo_unitario)})`;
    await tx`INSERT INTO loja_movimentos(variante_id,diferenca,motivo)
      VALUES(${v.id},${id(item.quantidade)},${"compra #"+c.id})`;
   }
   if(total>0) await tx`INSERT INTO loja_financeiro(tipo,categoria,descricao,valor,status,compra_id,registrado_por,data_movimento)
    VALUES('saida','mercadorias',${"Compra de estoque #"+c.id},${Math.round(total*100)/100},'pago',${c.id},${req.usuario.id},${dataComercial()})`;
   return c;
  });
  res.status(201).json(compra);
 }catch(e){erro(res,e);}
});

// VENDAS / PDV — operação atômica com desconto e histórico financeiro
router.get("/vendas",async(req,res)=>{
 try{res.json(await sql`SELECT p.id,p.cliente_id,p.canal,p.status,p.criado_em,p.desconto,p.forma_pagamento,p.observacao,c.nome AS cliente,
 GREATEST(0,COALESCE(SUM(i.quantidade*i.preco_unitario),0)-p.desconto) AS total
 FROM loja_pedidos p LEFT JOIN loja_clientes c ON c.id=p.cliente_id
 LEFT JOIN loja_pedido_itens i ON i.pedido_id=p.id
 GROUP BY p.id,c.nome ORDER BY p.id DESC LIMIT 100`);}
 catch(e){erro(res,e);}
});
router.post("/vendas",async(req,res)=>{
 const {cliente_id,canal,forma_pagamento,desconto,itens,observacao}=req.body||{};
 const disc=valor(desconto??0);
 if(!["loja","whatsapp","instagram"].includes(canal)||
   !["dinheiro","pix","debito","credito","outro"].includes(forma_pagamento) ||
   disc===null || (cliente_id!=null&&!id(cliente_id)) ||
   !Array.isArray(itens) || !itens.length || itens.length>80 ||
   itens.some(i=>!id(i.variante_id)||!id(i.quantidade)||id(i.quantidade)>100000))
   return res.status(400).json({mensagem:"Revise os produtos, pagamento e desconto"});
 const aggregate=new Map();
 for(const i of itens) aggregate.set(id(i.variante_id),(aggregate.get(id(i.variante_id))||0)+id(i.quantidade));
 if([...aggregate.values()].some(q=>q>100000))return res.status(400).json({mensagem:"Quantidade inválida"});
 try{
  const venda=await sql.begin(async tx=>{
   let subtotal=0;
   const resolved=[];
   for(const [variantId,q] of [...aggregate].sort((a,b)=>a[0]-b[0])){
    const [v]=await tx`SELECT v.id,p.preco,p.custo FROM loja_variantes v JOIN loja_produtos p ON p.id=v.produto_id WHERE v.id=${variantId} AND p.ativo=true`;
    if(!v)throw Error("ITEM_INVALIDO");
    subtotal+=Number(v.preco)*q;
    resolved.push({id:variantId,q,preco:Number(v.preco),custo:v.custo===null?null:Number(v.custo)});
   }
   if(disc>Math.round(subtotal*100)/100)throw Error("DESCONTO_INVALIDO");
   const total=Math.round((subtotal-disc)*100)/100;
   const [p]=await tx`INSERT INTO loja_pedidos(cliente_id,canal,status,desconto,forma_pagamento,observacao,criado_por)
     VALUES(${cliente_id?id(cliente_id):null},${canal},'rascunho',${disc},${forma_pagamento},${str(observacao,600)||null},${req.usuario.id}) RETURNING id`;
   for(const item of resolved){
    const [updated]=await tx`UPDATE loja_variantes SET quantidade=quantidade-${item.q}
     WHERE id=${item.id} AND quantidade>=${item.q} RETURNING id`;
    if(!updated)throw Error("SEM_ESTOQUE");
    await tx`INSERT INTO loja_pedido_itens(pedido_id,variante_id,quantidade,preco_unitario,custo_unitario)
     VALUES(${p.id},${item.id},${item.q},${item.preco},${item.custo})`;
    await tx`INSERT INTO loja_movimentos(variante_id,pedido_id,diferenca,motivo)
     VALUES(${item.id},${p.id},${-item.q},'venda')`;
   }
   await tx`UPDATE loja_pedidos SET status='pago',finalizado_em=NOW() WHERE id=${p.id}`;
   if(total>0)await tx`INSERT INTO loja_financeiro(tipo,categoria,descricao,valor,status,pedido_id,registrado_por,data_movimento)
    VALUES('entrada','vendas',${"Venda #"+p.id+" ("+forma_pagamento+")"},${total},'pago',${p.id},${req.usuario.id},${dataComercial()})`;
   return {id:p.id,total};
  });
  res.status(201).json(venda);
 }catch(e){if(e.message==="DESCONTO_INVALIDO")return res.status(400).json({mensagem:"Desconto maior que o subtotal"});erro(res,e);}
});
router.post("/vendas/:id/cancelar",gestor,async(req,res)=>{
 const pedidoId=id(req.params.id);
 if(!pedidoId)return res.status(400).json({mensagem:"Pedido inválido"});
 try{
 const result=await sql.begin(async tx=>{
  const [p]=await tx`SELECT * FROM loja_pedidos WHERE id=${pedidoId} FOR UPDATE`;
  if(!p)throw Error("INEXISTENTE");
  if(p.status!=="pago")throw Error("STATUS_INVALIDO");
  const itens=await tx`SELECT variante_id,SUM(quantidade)::int AS qtd FROM loja_pedido_itens
   WHERE pedido_id=${p.id} GROUP BY variante_id ORDER BY variante_id`;
  for(const item of itens){
   await tx`UPDATE loja_variantes SET quantidade=quantidade+${item.qtd} WHERE id=${item.variante_id}`;
   await tx`INSERT INTO loja_movimentos(variante_id,pedido_id,diferenca,motivo)
    VALUES(${item.variante_id},${p.id},${item.qtd},'cancelamento')`;
  }
  const [totalRow]=await tx`SELECT GREATEST(0,COALESCE(SUM(quantidade*preco_unitario),0)-${Number(p.desconto)}) AS total
   FROM loja_pedido_itens WHERE pedido_id=${p.id}`;
  await tx`UPDATE loja_pedidos SET status='cancelado' WHERE id=${p.id}`;
  if(Number(totalRow.total)>0)await tx`INSERT INTO loja_financeiro(tipo,categoria,descricao,valor,status,pedido_id,registrado_por,data_movimento)
    VALUES('saida','estorno',${"Cancelamento da venda #"+p.id},${Number(totalRow.total)},'pago',${p.id},${req.usuario.id},${dataComercial()})`;
  return {id:p.id,status:"cancelado"};
 });
 res.json(result);
 }catch(e){erro(res,e);}
});

// FINANCEIRO (valores registrados, sem integração com gateways)
router.get("/financeiro",gestor,async(req,res)=>{
 try{const [lancamentos,resumo]=await Promise.all([
  sql`SELECT * FROM loja_financeiro ORDER BY data_movimento DESC,id DESC LIMIT 250`,
  sql`SELECT
  COALESCE(SUM(valor) FILTER (WHERE tipo='entrada' AND status='pago'),0) AS entradas,
  COALESCE(SUM(valor) FILTER (WHERE tipo='saida' AND status='pago'),0) AS saidas,
  COALESCE(SUM(valor) FILTER (WHERE status='pendente'),0) AS pendentes
  FROM loja_financeiro`
 ]);res.json({lancamentos,resumo});}
 catch(e){erro(res,e);}
});
router.post("/financeiro",gestor,async(req,res)=>{
 const {tipo,categoria,descricao,valor:amount,status,data_movimento}=req.body||{};
 if(!["entrada","saida"].includes(tipo)||!["pago","pendente"].includes(status)||!str(categoria,80)||!str(descricao,180)||valor(amount)===null||valor(amount)===0||(data_movimento&&!okDate(data_movimento)))
 return res.status(400).json({mensagem:"Lançamento inválido"});
 try{const [l]=await sql`INSERT INTO loja_financeiro(tipo,categoria,descricao,valor,status,data_movimento,registrado_por)
 VALUES(${tipo},${str(categoria,80)},${str(descricao,180)},${valor(amount)},${status},${data_movimento||dataComercial()},${req.usuario.id}) RETURNING *`;
 res.status(201).json(l);}
 catch(e){erro(res,e);}
});

// RELATÓRIOS
router.get("/relatorios",gestor,async(req,res)=>{
 const hoje=new Date().toISOString().slice(0,10);
 const de=okDate(req.query.de)||new Date(Date.now()-30*86400000).toISOString().slice(0,10);
 const ate=okDate(req.query.ate)||hoje;
 if(de>ate)return res.status(400).json({mensagem:"Período inválido"});
 try{
  const [totais, canais, maisVendidos, dias] = await Promise.all([
   sql`SELECT COUNT(DISTINCT p.id)::int AS vendas,
    COALESCE(SUM(i.quantidade*i.preco_unitario),0) AS bruto,
    COALESCE(SUM(i.quantidade*(i.preco_unitario-COALESCE(i.custo_unitario,prod.custo,0))),0) AS margem_bruta,
    COALESCE((SELECT SUM(desconto) FROM loja_pedidos WHERE status='pago' AND (COALESCE(finalizado_em,criado_em) AT TIME ZONE 'America/Sao_Paulo')::date BETWEEN ${de} AND ${ate}),0) AS descontos
    FROM loja_pedidos p
    LEFT JOIN loja_pedido_itens i ON i.pedido_id=p.id
    LEFT JOIN loja_variantes v ON v.id=i.variante_id
    LEFT JOIN loja_produtos prod ON prod.id=v.produto_id
    WHERE p.status='pago' AND (COALESCE(p.finalizado_em,p.criado_em) AT TIME ZONE 'America/Sao_Paulo')::date BETWEEN ${de} AND ${ate}`,
   sql`SELECT p.canal,COUNT(DISTINCT p.id)::int AS vendas,
    GREATEST(0,COALESCE(SUM(i.quantidade*i.preco_unitario),0)-COALESCE((SELECT SUM(desconto) FROM loja_pedidos pd WHERE pd.canal=p.canal AND pd.status='pago' AND (COALESCE(pd.finalizado_em,pd.criado_em) AT TIME ZONE 'America/Sao_Paulo')::date BETWEEN ${de} AND ${ate}),0)) AS total
    FROM loja_pedidos p LEFT JOIN loja_pedido_itens i ON i.pedido_id=p.id
    WHERE p.status='pago' AND (COALESCE(p.finalizado_em,p.criado_em) AT TIME ZONE 'America/Sao_Paulo')::date BETWEEN ${de} AND ${ate} GROUP BY p.canal ORDER BY total DESC`,
   sql`SELECT prod.nome,v.tamanho,v.cor, SUM(i.quantidade)::int AS pecas, SUM(i.quantidade*i.preco_unitario) AS bruto
    FROM loja_pedido_itens i JOIN loja_pedidos p ON p.id=i.pedido_id
    JOIN loja_variantes v ON v.id=i.variante_id JOIN loja_produtos prod ON prod.id=v.produto_id
    WHERE p.status='pago' AND (COALESCE(p.finalizado_em,p.criado_em) AT TIME ZONE 'America/Sao_Paulo')::date BETWEEN ${de} AND ${ate}
    GROUP BY prod.nome,v.tamanho,v.cor ORDER BY pecas DESC LIMIT 10`,
   sql`SELECT (COALESCE(p.finalizado_em,p.criado_em) AT TIME ZONE 'America/Sao_Paulo')::date AS dia, COUNT(DISTINCT p.id)::int AS vendas,
    COALESCE(SUM(i.quantidade*i.preco_unitario),0) AS bruto
    FROM loja_pedidos p LEFT JOIN loja_pedido_itens i ON i.pedido_id=p.id
    WHERE p.status='pago' AND (COALESCE(p.finalizado_em,p.criado_em) AT TIME ZONE 'America/Sao_Paulo')::date BETWEEN ${de} AND ${ate}
    GROUP BY (COALESCE(p.finalizado_em,p.criado_em) AT TIME ZONE 'America/Sao_Paulo')::date ORDER BY dia`
  ]);
  const t=totais[0];const margem=Number(t.margem_bruta)-Number(t.descontos);
  res.json({de,ate,totais:{...t,faturamento:Math.max(0,Number(t.bruto)-Number(t.descontos)),lucro_estimado:margem},
  canais,maisVendidos,dias,nota:"Lucro estimado = vendas - custo das peças - descontos. Despesas gerais não incluídas; produtos antigos sem custo podem superestimar a margem."});
 }catch(e){erro(res,e);}
});
router.get("/dashboard",async(req,res)=>{
 try{
  const [produto,estoque,vendasDia,top,lucroDia]=await Promise.all([
   sql`SELECT COUNT(*)::int AS produtos FROM loja_produtos WHERE ativo=true`,
   sql`SELECT COALESCE(SUM(v.quantidade),0)::int AS pecas,
    COUNT(*) FILTER (WHERE v.quantidade<=v.minimo)::int AS alertas
    FROM loja_variantes v JOIN loja_produtos p ON p.id=v.produto_id WHERE p.ativo=true`,
   sql`SELECT COUNT(DISTINCT p.id)::int AS vendas, COALESCE(SUM(i.preco_unitario*i.quantidade),0) AS bruto,
     COALESCE((SELECT SUM(desconto) FROM loja_pedidos WHERE status='pago' AND (COALESCE(finalizado_em,criado_em) AT TIME ZONE 'America/Sao_Paulo')::date=CURRENT_DATE),0) AS descontos
    FROM loja_pedidos p LEFT JOIN loja_pedido_itens i ON i.pedido_id=p.id
    WHERE p.status='pago' AND (COALESCE(p.finalizado_em,p.criado_em) AT TIME ZONE 'America/Sao_Paulo')::date=CURRENT_DATE`,
   sql`SELECT prod.nome,SUM(i.quantidade)::int AS pecas
    FROM loja_pedido_itens i JOIN loja_pedidos p ON p.id=i.pedido_id JOIN loja_variantes v ON v.id=i.variante_id
    JOIN loja_produtos prod ON prod.id=v.produto_id WHERE p.status='pago'
    GROUP BY prod.id,prod.nome ORDER BY pecas DESC LIMIT 5`,
   sql`SELECT COALESCE(SUM(i.quantidade*(i.preco_unitario-COALESCE(i.custo_unitario,prod.custo,0))),0) AS margem
    FROM loja_pedidos p JOIN loja_pedido_itens i ON i.pedido_id=p.id
    JOIN loja_variantes v ON v.id=i.variante_id JOIN loja_produtos prod ON prod.id=v.produto_id
    WHERE p.status='pago' AND (COALESCE(p.finalizado_em,p.criado_em) AT TIME ZONE 'America/Sao_Paulo')::date=CURRENT_DATE`
  ]);
  res.json({...produto[0],...estoque[0],vendas_hoje:vendasDia[0].vendas,
   faturamento_hoje:Math.max(0,Number(vendasDia[0].bruto)-Number(vendasDia[0].descontos)),
   lucro_hoje_estimado:Number(lucroDia[0].margem)-Number(vendasDia[0].descontos),top});
 }catch(e){erro(res,e);}
});

// CONFIGURAÇÕES / FUNCIONÁRIOS
router.get("/usuarios",gestor,async(req,res)=>{
 try{res.json(await sql`SELECT id,nome,role,ativo,criado_em FROM loja_usuarios ORDER BY id`);}
 catch(e){erro(res,e);}
});
router.post("/usuarios",gestor,async(req,res)=>{
 const {nome,senha,role}=req.body||{};
 if(!str(nome,100)||typeof senha!=="string"||senha.length<10||senha.length>128||!["gestor","funcionario"].includes(role))
  return res.status(400).json({mensagem:"Informe nome, senha de pelo menos 10 caracteres e função"});
 try{
  const hash=await bcrypt.hash(senha,12);
  const [u]=await sql`INSERT INTO loja_usuarios(nome,senha_hash,role) VALUES(${str(nome,100)},${hash},${role}) RETURNING id,nome,role,ativo`;
  res.status(201).json(u);
 }catch(e){erro(res,e);}
});
router.patch("/usuarios/:id",gestor,async(req,res)=>{
 const usuarioId=id(req.params.id),{role,ativo}=req.body||{};
 if(!usuarioId||!["gestor","funcionario"].includes(role)||typeof ativo!=="boolean")
  return res.status(400).json({mensagem:"Dados inválidos"});
 if(usuarioId===Number(req.usuario.id)&&(!ativo||role!=="gestor"))
  return res.status(400).json({mensagem:"Você não pode remover seu próprio acesso de administradora"});
 try{
  const [u]=await sql`UPDATE loja_usuarios SET role=${role},ativo=${ativo} WHERE id=${usuarioId} RETURNING id,nome,role,ativo`;
  if(!u)return res.status(404).json({mensagem:"Usuário não encontrado"});
  res.json(u);
 }catch(e){erro(res,e);}
});
router.post("/usuarios/:id/senha",gestor,async(req,res)=>{
 const usuarioId=id(req.params.id),senha=req.body?.senha;
 if(!usuarioId||typeof senha!=="string"||senha.length<10||senha.length>128)return res.status(400).json({mensagem:"Senha inválida"});
 try{const hash=await bcrypt.hash(senha,12);const [u]=await sql`UPDATE loja_usuarios SET senha_hash=${hash} WHERE id=${usuarioId} RETURNING id`;
  if(!u)return res.status(404).json({mensagem:"Usuário não encontrado"});
  res.json({ok:true});
 }catch(e){erro(res,e);}
});
export default router;
