import test from "node:test";
import assert from "node:assert/strict";
import {readFile} from "node:fs/promises";
import {spawn} from "node:child_process";
import postgres from "postgres";
import bcrypt from "bcrypt";

const ROOT=new URL("../",import.meta.url);
const BASE="http://127.0.0.1:43313",PORT=43313;
const sleep=ms=>new Promise(r=>setTimeout(r,ms));
async function api(path,{token,method="GET",body}={}){
 const r=await fetch(BASE+path,{
  method,headers:{
   ...(token?{Authorization:"Bearer "+token}:{}),
   ...(body===undefined?{}:{"Content-Type":"application/json"})
  },body:body===undefined?undefined:JSON.stringify(body)
 });
 const data=await r.json().catch(()=>({}));
 return {status:r.status,data};
}
const confirm={motivo:"Cancelamento lançado por engano na loja",confirmar_sem_devolucao:true};
const cents=v=>Math.round(Number(v||0)*100);

test("V9: desfazer cancelamento sem perdas, caixa duplicado ou acesso indevido",
 {timeout:90000},async()=>{
 if(process.env.CI_DB_TEST!=="true"||!process.env.DATABASE_URL)
  throw Error("Use somente banco descartável do GitHub Actions.");
 const db=postgres(process.env.DATABASE_URL,{ssl:false,max:1});
 let child,output="";
 try{
  for(const filename of ["sql/001_schema_limpo.sql","sql/002_modulos_v6.sql",
    "sql/003_pedidos_pendentes_v7.sql","sql/004_crediario_clientes_v8.sql"]){
   const content=(await readFile(new URL(filename,ROOT),"utf8")).replace(/^\s*--.*$/gm,"");
   for(const stmt of content.split(";").map(x=>x.trim()).filter(Boolean))await db.unsafe(stmt);
  }
  const id=Date.now(),password="senhaV9SomenteNoCI2026";
  const manager="ReversaoGestor"+id,staff="ReversaoFunc"+id;
  const hash=await bcrypt.hash(password,10);
  await db`INSERT INTO loja_usuarios(nome,senha_hash,role)
    VALUES(${manager},${hash},'gestor'),(${staff},${hash},'funcionario')`;

  child=spawn(process.execPath,["src/app.js"],{
   cwd:ROOT,env:{...process.env,PORT:String(PORT),DB_SSL:"false",
    FRONTEND_URL:"http://localhost:5173",
    SESSION_SECRET:"segredo-do-ci-reversao-apenas-testes-postgresql-v9"},
   stdio:["ignore","pipe","pipe"]
  });
  child.stdout.on("data",data=>output+=data);
  child.stderr.on("data",data=>output+=data);
  let ready=false;
  for(let i=0;i<100;i++){
   if(child.exitCode!==null)throw Error("API falhou: "+output);
   try{if((await fetch(BASE+"/health")).ok){ready=true;break;}}catch{}
   await sleep(120);
  }
  assert.ok(ready,"API não iniciou: "+output);
  const login=async nome=>api("/api/auth/login",{method:"POST",body:{nome,senha:password}});
  const adminLogin=await login(manager),employeeLogin=await login(staff);
  assert.equal(adminLogin.status,200,JSON.stringify(adminLogin.data));
  assert.equal(employeeLogin.status,200,JSON.stringify(employeeLogin.data));
  const admin=adminLogin.data.token,employee=employeeLogin.data.token;
  const restId=orderId=>"/api/v9/vendas/"+orderId+"/desfazer-cancelamento";
  const getStock=async variantId=>{
   const [row]=await db`SELECT quantidade FROM loja_variantes WHERE id=${variantId}`;
   return Number(row.quantidade);
  };
  const ledger=async orderId=>db`
   SELECT id,tipo,categoria,valor FROM loja_financeiro
   WHERE pedido_id=${orderId} ORDER BY id`;

  const sku="REV-"+id;
  const product=await api("/api/v6/produtos",{method:"POST",token:admin,body:{
   nome:"Blusa Teste Reversão",categoria:"Blusas",preco:49.90,custo:20,
   variantes:[{sku,tamanho:"M",cor:"Rosa",quantidade:12,minimo:1}]
  }});
  assert.equal(product.status,201,JSON.stringify(product.data));
  const [variant]=await db`SELECT id FROM loja_variantes WHERE sku=${sku}`;
  const newSale=async({quantity=2,payment="pix",customer=null}={})=>api("/api/v6/vendas",{
   method:"POST",token:admin,body:{
    canal:"loja",forma_pagamento:payment,
    cliente_id:customer,desconto:0,
    itens:[{variante_id:variant.id,quantidade:quantity}],
    ...(payment==="crediario"?
     {numero_parcelas:2,primeiro_vencimento:"2026-12-15",intervalo_dias:30}:{})
   }
  });
  const sell=await newSale();
  assert.equal(sell.status,201,JSON.stringify(sell.data));
  const saleId=sell.data.id;
  assert.equal(await getStock(variant.id),10);
  const rev=restId(saleId);

  assert.equal((await api(rev,{method:"POST",body:confirm})).status,401);
  assert.equal((await api(rev,{token:employee,method:"POST",body:confirm})).status,403);
  assert.equal((await api(rev,{token:admin,method:"POST",body:confirm})).status,409,
   "Venda ativa não pode ser restaurada");
  const canceled=await api(`/api/v6/vendas/${saleId}/cancelar`,{method:"POST",token:admin});
  assert.equal(canceled.status,200,JSON.stringify(canceled.data));
  assert.equal(await getStock(variant.id),12);
  assert.equal((await api(rev,{token:admin,method:"POST",body:{...confirm,confirmar_sem_devolucao:false}})).status,400);
  assert.equal((await api(rev,{token:admin,method:"POST",body:{...confirm,motivo:"oi"}})).status,400);
  assert.equal((await api(rev,{token:admin,method:"POST",body:{...confirm,confirmar_sem_devolucao:"true"}})).status,400);
  assert.equal((await api(restId(9999999),{token:admin,method:"POST",body:confirm})).status,404);

  const listed=await api("/api/v6/vendas",{token:admin});
  assert.equal(listed.status,200);
  assert.equal(listed.data.find(v=>v.id==saleId).cancelamento_reversivel,true);
  const before=await ledger(saleId);
  assert.deepEqual(before.map(x=>x.categoria),["vendas","estorno"]);
  const undone=await api(rev,{token:admin,method:"POST",body:confirm});
  assert.equal(undone.status,200,JSON.stringify(undone.data));
  assert.equal(undone.data.status,"pago");
  assert.equal(await getStock(variant.id),10);
  const after=await ledger(saleId);
  assert.equal(after.length,3);
  assert.equal(after[2].categoria,"reversao_estorno");
  assert.equal(after[2].tipo,"entrada");
  assert.equal(cents(after[2].valor),9980);
  assert.equal(after.reduce((sum,x)=>sum+(x.tipo==="entrada"?cents(x.valor):-cents(x.valor)),0),9980);
  const [audit]=await db`
   SELECT operacao,detalhes FROM loja_auditoria_v7
   WHERE entidade='pedido' AND registro_id=${saleId} AND operacao='cancelamento_desfeito'`;
  assert.equal(audit.operacao,"cancelamento_desfeito");
  assert.equal(audit.detalhes.motivo,confirm.motivo);
  assert.equal(audit.detalhes.confirmar_sem_devolucao,true);

  const again=await api(rev,{token:admin,method:"POST",body:confirm});
  assert.equal(again.status,409,"Desfazer duas vezes não deve duplicar movimento");
  assert.equal(await getStock(variant.id),10);
  assert.equal((await ledger(saleId)).length,3);

  // Vários ciclos de engano preservam saldo e não fazem duplicação.
  assert.equal((await api(`/api/v6/vendas/${saleId}/cancelar`,{method:"POST",token:admin})).status,200);
  assert.equal(await getStock(variant.id),12);
  assert.equal((await api(rev,{token:admin,method:"POST",body:confirm})).status,200);
  assert.equal(await getStock(variant.id),10);
  const cycles=await ledger(saleId);
  assert.equal(cycles.filter(x=>x.categoria==="reversao_estorno").length,2);
  assert.equal(cycles.reduce((sum,x)=>sum+(x.tipo==="entrada"?cents(x.valor):-cents(x.valor)),0),9980);

  // Insuficiência de estoque deve reverter a transação inteira.
  const scarce=await newSale({quantity:2});
  assert.equal(scarce.status,201,JSON.stringify(scarce.data));
  assert.equal((await api(`/api/v6/vendas/${scarce.data.id}/cancelar`,{
   token:admin,method:"POST"})).status,200);
  await db`UPDATE loja_variantes SET quantidade=1 WHERE id=${variant.id}`;
  const stockBefore=await getStock(variant.id);
  const failStock=await api(restId(scarce.data.id),{token:admin,method:"POST",body:confirm});
  assert.equal(failStock.status,409,JSON.stringify(failStock.data));
  assert.match(failStock.data.mensagem,/estoque/i);
  assert.equal(await getStock(variant.id),stockBefore);
  const [scarceOrder]=await db`SELECT status FROM loja_pedidos WHERE id=${scarce.data.id}`;
  assert.equal(scarceOrder.status,"cancelado");
  assert.equal((await ledger(scarce.data.id)).filter(x=>x.categoria==="reversao_estorno").length,0);
  await db`UPDATE loja_variantes SET quantidade=10 WHERE id=${variant.id}`;

  // Pedido V7 cancelado antes de venda não pode ser "desfeito" como venda.
  const pending=await api("/api/v7/pendentes",{token:admin,method:"POST",body:{
   canal:"whatsapp",desconto:0,
   itens:[{variante_id:variant.id,quantidade:1}]
  }});
  assert.equal(pending.status,201,JSON.stringify(pending.data));
  assert.equal((await api(`/api/v7/pendentes/${pending.data.id}/cancelar`,{
   token:admin,method:"POST"})).status,200);
  const pendingUndo=await api(restId(pending.data.id),{token:admin,method:"POST",body:confirm});
  assert.equal(pendingUndo.status,409);
  const sales=await api("/api/v6/vendas",{token:admin});
  assert.equal(sales.data.find(v=>v.id==pending.data.id).cancelamento_reversivel,false);

  // Venda no crediário cancelada sem Pix: reabre conta, sem movimentar caixa.
  const customer=await api("/api/lajustore/clientes",{token:admin,method:"POST",
   body:{nome:"Cliente Reversao "+id,telefone:"",instagram:""}});
  assert.equal(customer.status,201,JSON.stringify(customer.data));
  const credit=await newSale({quantity:1,payment:"crediario",customer:customer.data.id});
  assert.equal(credit.status,201,JSON.stringify(credit.data));
  const [beforeCredit]=await db`
    SELECT status FROM loja_crediario WHERE id=${credit.data.crediario_id}`;
  assert.equal(beforeCredit.status,"aberto");
  assert.equal((await api(`/api/v6/vendas/${credit.data.id}/cancelar`,{
   token:admin,method:"POST"})).status,200);
  const creditLedgerBefore=await ledger(credit.data.id);
  assert.equal(creditLedgerBefore.length,0);
  const creditRestored=await api(restId(credit.data.id),{token:admin,method:"POST",body:confirm});
  assert.equal(creditRestored.status,200,JSON.stringify(creditRestored.data));
  assert.equal(creditRestored.data.crediario_reaberto,true);
  const [account]=await db`
    SELECT status FROM loja_crediario WHERE id=${credit.data.crediario_id}`;
  assert.equal(account.status,"aberto");
  assert.equal((await ledger(credit.data.id)).length,0);
 }finally{
  if(child&&child.exitCode===null)child.kill("SIGTERM");
  await db.end();
 }
});
