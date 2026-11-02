import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs/promises";
import {spawn} from "node:child_process";
import postgres from "postgres";
import bcrypt from "bcrypt";

const ROOT=new URL("../",import.meta.url);
const PORT=43217,BASE=`http://127.0.0.1:${PORT}`;
const wait=t=>new Promise(r=>setTimeout(r,t));
const day=()=>new Intl.DateTimeFormat("en-CA",{
 timeZone:"America/Sao_Paulo",year:"numeric",month:"2-digit",day:"2-digit"
}).format(new Date());
async function api(path,{method="GET",body,token}={}){
 const response=await fetch(BASE+path,{method,headers:{
  ...(body?{"Content-Type":"application/json"}:{}),
  ...(token?{Authorization:`Bearer ${token}`}:{})
 },body:body===undefined?undefined:JSON.stringify(body)});
 let data;try{data=await response.json();}catch{data={};}
 return {status:response.status,data};
}

test("Crediário V8: venda em aberto, pagamentos parciais Pix, estoque, financeiro, permissões e exportação",{
 timeout:75000
},async()=>{
 if(process.env.CI_DB_TEST!=="true"||!process.env.DATABASE_URL)
  throw Error("Exige PostgreSQL descartável no GitHub Actions.");
 const db=postgres(process.env.DATABASE_URL,{ssl:false,max:1});
 let proc,logs="";
 try{
  for(const file of ["sql/001_schema_limpo.sql","sql/002_modulos_v6.sql",
   "sql/003_pedidos_pendentes_v7.sql","sql/004_crediario_clientes_v8.sql"]){
   const script=(await fs.readFile(new URL(file,ROOT),"utf8")).replace(/^\s*--.*$/gm,"");
   for(const q of script.split(";").map(x=>x.trim()).filter(Boolean))await db.unsafe(q);
  }
  const pass="senhaDeTeste2026";
  const hash=await bcrypt.hash(pass,10);
  const stamp=Date.now();
  const manager=`CrediarioGestor${stamp}`,staff=`CrediarioFunc${stamp}`;
  await db`INSERT INTO loja_usuarios(nome,senha_hash,role)
   VALUES(${manager},${hash},'gestor'),(${staff},${hash},'funcionario')`;
  proc=spawn(process.execPath,["src/app.js"],{
   cwd:new URL(".",ROOT),
   env:{...process.env,PORT:String(PORT),DB_SSL:"false",
    FRONTEND_URL:"http://localhost:5173",SESSION_SECRET:"somente-para-testar-o-crediario-v8-na-ci-2026"},
   stdio:["ignore","pipe","pipe"]
  });
  proc.stdout.on("data",x=>logs+=x.toString());
  proc.stderr.on("data",x=>logs+=x.toString());
  let ready=false;
  for(let n=0;n<90;n++){
   if(proc.exitCode!==null)throw Error("API parou: "+logs);
   try{if((await fetch(BASE+"/health")).ok){ready=true;break;}}catch{}
   await wait(130);
  }
  assert.ok(ready,"API não respondeu: "+logs);
  const login=async nome=>api("/api/auth/login",{method:"POST",body:{nome,senha:pass}});
  const m=await login(manager),s=await login(staff);
  assert.equal(m.status,200,JSON.stringify(m.data));
  assert.equal(s.status,200,JSON.stringify(s.data));
  const admin=m.data.token,employee=s.data.token;

  assert.equal((await api("/api/v8/crediario")).status,401);
  assert.equal((await api("/api/v8/crediario",{token:employee})).status,403);
  assert.equal((await api("/api/v8/crediario/resumo",{token:employee})).status,403);
  const initial=await api("/api/v8/crediario/resumo",{token:admin});
  assert.equal(initial.status,200,JSON.stringify(initial.data));

  const sku=`CRED-${stamp}`;
  const product=await api("/api/v6/produtos",{method:"POST",token:admin,body:{
   nome:"Blusa crediario teste",categoria:"Blusas",preco:100.29,custo:45.01,
   variantes:[{sku,tamanho:"M",cor:"Rosa",quantidade:5,minimo:1}]
  }});
  assert.equal(product.status,201,JSON.stringify(product.data));
  const [variant]=await db`SELECT v.id,v.quantidade FROM loja_variantes v WHERE v.sku=${sku}`;
  assert.ok(variant);
  const customer=await api("/api/lajustore/clientes",{method:"POST",token:admin,
   body:{nome:`ClienteTeste${stamp}`,telefone:"",instagram:""}});
  assert.equal(customer.status,201,JSON.stringify(customer.data));
  const cid=customer.data.id;
  assert.ok(cid,"cliente deve ter ID");

  const proposed={cliente_id:cid,canal:"whatsapp",forma_pagamento:"crediario",
   desconto:0,numero_parcelas:2,primeiro_vencimento:"2026-12-15",intervalo_dias:30,
   itens:[{variante_id:variant.id,quantidade:2}]};
  assert.equal((await api("/api/v6/vendas",{method:"POST",token:employee,body:proposed})).status,403);
  assert.equal((await api("/api/v6/vendas",{method:"POST",token:admin,body:{...proposed,cliente_id:null}})).status,400);
  assert.equal((await api("/api/v6/vendas",{method:"POST",token:admin,body:{...proposed,numero_parcelas:7}})).status,400);

  const beforeLedger=await api("/api/v6/financeiro",{token:admin});
  assert.equal(beforeLedger.status,200,JSON.stringify(beforeLedger.data));
  const sale=await api("/api/v6/vendas",{method:"POST",token:admin,body:proposed});
  assert.equal(sale.status,201,JSON.stringify(sale.data));
  assert.ok(sale.data.crediario_id);
  assert.equal(sale.data.total,200.58);
  const creditId=sale.data.crediario_id;
  const [stock]=await db`SELECT quantidade FROM loja_variantes WHERE id=${variant.id}`;
  assert.equal(stock.quantidade,3,"crediário entrega as peças agora");
  const afterSaleLedger=await api("/api/v6/financeiro",{token:admin});
  assert.equal(Number(afterSaleLedger.data.resumo[0].entradas),Number(beforeLedger.data.resumo[0].entradas),
   "crediário não deve antecipar entrada no caixa");
  const open=await api("/api/v8/crediario?cliente_id="+cid,{token:admin});
  assert.equal(open.status,200,JSON.stringify(open.data));
  const acc=open.data.find(x=>x.id===creditId);
  assert.ok(acc,"conta aberta deve aparecer por cliente");
  assert.equal(acc.status,"aberto");
  assert.equal(acc.saldo,200.58);
  assert.equal(acc.parcelas.length,2);
  assert.equal(acc.parcelas[0].valor,100.29);
  assert.equal(acc.parcelas[1].valor,100.29);

  const key="testePixCrediario_"+stamp;
  const first={valor:100.29,forma_pagamento:"pix",chave_operacao:key,observacao:"Primeiro Pix"};
  const partial=await api(`/api/v8/crediario/${creditId}/pagamentos`,{method:"POST",token:admin,body:first});
  assert.equal(partial.status,201,JSON.stringify(partial.data));
  assert.equal(partial.data.saldo,100.29);
  const repeated=await api(`/api/v8/crediario/${creditId}/pagamentos`,{method:"POST",token:admin,body:first});
  assert.equal(repeated.status,200,JSON.stringify(repeated.data));
  assert.equal(repeated.data.repetido,true);
  assert.equal((await api(`/api/v8/crediario/${creditId}/pagamentos`,{method:"POST",token:admin,body:{...first,valor:80}})).status,409);
  assert.equal((await api(`/api/v8/crediario/${creditId}/pagamentos`,{method:"POST",token:admin,body:{...first,chave_operacao:"otherPixTest_"+stamp,valor:100.30}})).status,409);
  assert.equal((await api(`/api/v8/crediario/${creditId}/pagamentos`,{method:"POST",token:employee,body:first})).status,403);
  const details=await api(`/api/v8/crediario/${creditId}`,{token:admin});
  assert.equal(details.status,200,JSON.stringify(details.data));
  assert.equal(details.data.pagamentos.length,1);
  assert.equal(details.data.saldo,100.29);
  assert.equal(details.data.parcelas[0].situacao,"quitada");
  assert.equal(details.data.parcelas[1].saldo,100.29);

  const forbidCancel=await api(`/api/v6/vendas/${sale.data.id}/cancelar`,{method:"POST",token:admin});
  assert.equal(forbidCancel.status,409,"venda com Pix parcial não pode ser estornada sem conciliação");
  const second=await api(`/api/v8/crediario/${creditId}/pagamentos`,{method:"POST",token:admin,
   body:{valor:100.29,forma_pagamento:"pix",chave_operacao:"lastPixTest_"+stamp}});
  assert.equal(second.status,201,JSON.stringify(second.data));
  assert.equal(second.data.saldo,0);
  const paid=await api(`/api/v8/crediario/${creditId}`,{token:admin});
  assert.equal(paid.data.status,"quitado");
  assert.equal(paid.data.saldo,0);
  assert.equal(paid.data.pagamentos.length,2);
  const listOpen=await api("/api/v8/crediario?cliente_id="+cid,{token:admin});
  assert.equal(listOpen.data.some(x=>x.id===creditId),false);
  const all=await api("/api/v8/crediario?cliente_id="+cid+"&situacao=todas",{token:admin});
  assert.equal(all.data.find(x=>x.id===creditId).status,"quitado");
  const ledger=await api("/api/v6/financeiro",{token:admin});
  const receipts=ledger.data.lancamentos.filter(x=>x.pedido_id==sale.data.id&&x.categoria==="crediario");
  assert.equal(receipts.length,2,"duas parcelas, duas entradas no caixa");
  assert.equal(receipts.reduce((sum,x)=>sum+Math.round(Number(x.valor)*100),0),20058);
  assert.equal(Math.round((Number(ledger.data.resumo[0].entradas)-Number(beforeLedger.data.resumo[0].entradas))*100),20058);

  const dayRange=`?de=${day()}&ate=${day()}`;
  const indicators=await api("/api/operacao/financeiro/indicadores"+dayRange,{token:admin});
  assert.equal(indicators.status,200,JSON.stringify(indicators.data));
  assert.ok(indicators.data.faturamento>=200.58,"faturamento inclui a venda uma vez só");
  const exported=await api("/api/operacao/exportacao/dados-comerciais",{token:admin});
  assert.equal(exported.status,200,JSON.stringify(exported.data));
  assert.ok(exported.data.tabelas.loja_crediario.some(x=>x.id==creditId));
  assert.equal(exported.data.tabelas.loja_crediario_parcelas.filter(x=>x.crediario_id==creditId).length,2);
  assert.equal(exported.data.tabelas.loja_crediario_pagamentos.filter(x=>x.crediario_id==creditId).length,2);

  // Cancelar uma conta SEM recebimentos não cria saída fictícia do caixa.
  const other=await api("/api/v6/vendas",{method:"POST",token:admin,body:{
   ...proposed,itens:[{variante_id:variant.id,quantidade:1}]
  }});
  assert.equal(other.status,201,JSON.stringify(other.data));
  const beforeCancel=await api("/api/v6/financeiro",{token:admin});
  const canceled=await api(`/api/v6/vendas/${other.data.id}/cancelar`,{method:"POST",token:admin});
  assert.equal(canceled.status,200,JSON.stringify(canceled.data));
  const afterCancel=await api("/api/v6/financeiro",{token:admin});
  assert.equal(Number(afterCancel.data.resumo[0].saidas),Number(beforeCancel.data.resumo[0].saidas));
  const canceledAccount=await api(`/api/v8/crediario/${other.data.crediario_id}`,{token:admin});
  assert.equal(canceledAccount.data.status,"cancelado");
  const [stockEnd]=await db`SELECT quantidade FROM loja_variantes WHERE id=${variant.id}`;
  assert.equal(stockEnd.quantidade,3);
 }finally{
  if(proc&&proc.exitCode===null)proc.kill("SIGTERM");
  await db.end();
 }
});
