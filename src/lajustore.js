import express from "express";
import sql from "./bd.js";
import {requireSession} from "./session.js";
const router=express.Router();
router.use(requireSession);
router.use(async(req,res,next)=>{try{
 const [u]=await sql`SELECT id,role,ativo FROM loja_usuarios WHERE id=${req.session.id}`;
 if(!u?.ativo)return res.status(401).json({mensagem:'Usuário não autorizado'});
 req.session.role=u.role;next();
 }catch(e){return res.status(500).json({mensagem:'Erro de autorização'})}});
const fail=(res,e)=>{console.error("LajuStore:",e);return res.status(500).json({mensagem:"Erro ao consultar o banco"});};
router.get("/produtos",async(req,res)=>{try{
 const rows=await sql`SELECT p.id,p.nome,p.categoria,p.preco,p.custo,p.ativo,
 COALESCE(json_agg(json_build_object('id',v.id,'sku',v.sku,'tamanho',v.tamanho,'cor',v.cor,'quantidade',v.quantidade,'minimo',v.minimo) ORDER BY v.id) FILTER (WHERE v.id IS NOT NULL),'[]'::json) AS variantes
 FROM loja_produtos p LEFT JOIN loja_variantes v ON v.produto_id=p.id WHERE p.ativo=true GROUP BY p.id ORDER BY p.nome`;
 res.json(rows);
 }catch(e){fail(res,e)}});
router.post("/produtos",async(req,res)=>{try{
 const {nome,categoria,preco,custo,variantes}=req.body||{};
 if(typeof nome!=="string"||!nome.trim()||preco===undefined||preco===null||preco===""||!Number.isFinite(Number(preco))||Number(preco)<0||!Array.isArray(variantes)||variantes.length===0 || variantes.length>100) return res.status(400).json({mensagem:"Produto ou variantes inválidos"});
 const clean=[];const unique=new Set();
 for(const v of variantes){const key=`${v.tamanho}|${v.cor}`; if(typeof v.tamanho!=='string'||!v.tamanho.trim()||typeof v.cor!=='string'||!v.cor.trim()||typeof v.sku!=='string'||!v.sku.trim()||unique.has(key)||!Number.isInteger(Number(v.quantidade))||Number(v.quantidade)<0) return res.status(400).json({mensagem:"Variação inválida ou repetida"});unique.add(key);clean.push(v)}
 const result=await sql.begin(async tx=>{
 const [prod]=await tx`INSERT INTO loja_produtos(nome,categoria,preco,custo) VALUES(${nome.trim()},${categoria||null},${Number(preco)},${custo===''||custo==null?null:Number(custo)}) RETURNING id`;
 for(const v of clean) await tx`INSERT INTO loja_variantes(produto_id,sku,tamanho,cor,quantidade,minimo) VALUES(${prod.id},${String(v.sku)},${String(v.tamanho)},${String(v.cor)},${Number(v.quantidade)},${Number(v.minimo)||0})`;
 return prod;});res.status(201).json(result);
 }catch(e){if(e.code==='23505')return res.status(409).json({mensagem:"SKU ou variação já cadastrado"});fail(res,e)}});
router.get("/clientes",async(req,res)=>{try{res.json(await sql`SELECT * FROM loja_clientes ORDER BY nome LIMIT 500`)}catch(e){fail(res,e)}});
router.post("/clientes",async(req,res)=>{try{const {nome,telefone,instagram}=req.body;if(!nome?.trim())return res.status(400).json({mensagem:"Nome obrigatório"});const [row]=await sql`INSERT INTO loja_clientes(nome,telefone,instagram) VALUES(${nome.trim()},${telefone||null},${instagram||null}) RETURNING *`;res.status(201).json(row)}catch(e){fail(res,e)}});
router.get("/pedidos",async(req,res)=>{try{res.json(await sql`SELECT p.*,c.nome AS cliente,COALESCE(sum(i.quantidade*i.preco_unitario),0) AS total FROM loja_pedidos p LEFT JOIN loja_clientes c ON c.id=p.cliente_id LEFT JOIN loja_pedido_itens i ON i.pedido_id=p.id GROUP BY p.id,c.nome ORDER BY p.id DESC LIMIT 100`)}catch(e){fail(res,e)}});
router.post("/pedidos",async(req,res)=>{try{
 const {cliente_id,canal,itens}=req.body||{};
 if(!['loja','whatsapp','instagram'].includes(canal)||!Array.isArray(itens)||!itens.length||itens.length>100||itens.some(i=>!Number.isInteger(Number(i.variante_id))||!Number.isInteger(Number(i.quantidade))||Number(i.quantidade)<=0))return res.status(400).json({mensagem:"Pedido inválido"});
 const pedido=await sql.begin(async tx=>{
 const [p]=await tx`INSERT INTO loja_pedidos(cliente_id,canal,status) VALUES(${cliente_id||null},${canal},'rascunho') RETURNING *`;
 for(const item of itens){const [v]=await tx`SELECT v.id,p.preco FROM loja_variantes v JOIN loja_produtos p ON p.id=v.produto_id WHERE v.id=${Number(item.variante_id)} AND p.ativo=true`;if(!v)throw Error('VARIANTE_INVALIDA');await tx`INSERT INTO loja_pedido_itens(pedido_id,variante_id,quantidade,preco_unitario) VALUES(${p.id},${v.id},${Number(item.quantidade)},${v.preco})`;}return p;
 });res.status(201).json(pedido);
 }catch(e){if(e.message==='VARIANTE_INVALIDA')return res.status(400).json({mensagem:'Variante inexistente'});fail(res,e)}});
router.post("/pedidos/:id/concluir",async(req,res)=>{try{
 if(!/^\d+$/.test(req.params.id))return res.status(400).json({mensagem:"Pedido inválido"});
 const outcome=await sql.begin(async tx=>{
 const [p]=await tx`SELECT * FROM loja_pedidos WHERE id=${Number(req.params.id)} FOR UPDATE`;
 if(!p)return 'NAO_ENCONTRADO';if(p.status!=='rascunho')return 'INVALIDO';
 const itens=await tx`SELECT variante_id,SUM(quantidade)::int AS quantidade FROM loja_pedido_itens WHERE pedido_id=${p.id} GROUP BY variante_id ORDER BY variante_id`;
 if(!itens.length)return 'VAZIO';
 for(const item of itens){const [v]=await tx`UPDATE loja_variantes SET quantidade=quantidade-${item.quantidade} WHERE id=${item.variante_id} AND quantidade>=${item.quantidade} RETURNING id`;if(!v)throw Error('SEM_ESTOQUE');await tx`INSERT INTO loja_movimentos(variante_id,pedido_id,diferenca,motivo) VALUES(${item.variante_id},${p.id},${-item.quantidade},'venda')`;}
 await tx`UPDATE loja_pedidos SET status='pago' WHERE id=${p.id}`;return 'OK';
 });if(outcome!=='OK')return res.status(outcome==='NAO_ENCONTRADO'?404:409).json({mensagem:outcome});res.json({status:'pago'});
 }catch(e){if(e.message==='SEM_ESTOQUE')return res.status(409).json({mensagem:'Estoque insuficiente; venda não finalizada'});fail(res,e)}});
router.get('/resumo',async(req,res)=>{try{const [prod]=await sql`SELECT count(*)::int AS produtos FROM loja_produtos WHERE ativo=true`;const [stock]=await sql`SELECT COALESCE(sum(quantidade),0)::int AS pecas, count(*) FILTER (WHERE quantidade<=minimo)::int AS alertas FROM loja_variantes`;const [sales]=await sql`SELECT count(DISTINCT p.id)::int AS vendas,COALESCE(sum(i.quantidade*i.preco_unitario),0) AS faturamento FROM loja_pedidos p LEFT JOIN loja_pedido_itens i ON i.pedido_id=p.id WHERE p.status='pago'`;res.json({...prod,...stock,...sales})}catch(e){fail(res,e)}});
export default router;
