import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs/promises";
import {spawn} from "node:child_process";
import postgres from "postgres";
import bcrypt from "bcrypt";

const ROOT=new URL("../",import.meta.url);
const PORT=43198;
const URL_BASE=`http://127.0.0.1:${PORT}`;
const sleep=t=>new Promise(resolve=>setTimeout(resolve,t));
const dateLocal=()=>new Intl.DateTimeFormat("en-CA",{
 timeZone:"America/Sao_Paulo",year:"numeric",month:"2-digit",day:"2-digit"
}).format(new Date());

async function api(path,{method="GET",body,token}={}){
 const res=await fetch(URL_BASE+path,{
  method,
  headers:{
   ...(body!==undefined?{"Content-Type":"application/json"}:{}),
   ...(token?{Authorization:`Bearer ${token}`}:{})
  },
  body:body===undefined?undefined:JSON.stringify(body)
 });
 return {status:res.status,data:await res.json(),headers:res.headers};
}

test("Operação: alertas, finanças, exportação e permissões com PostgreSQL temporário",{timeout:70000},async()=>{
 if(!process.env.DATABASE_URL || process.env.CI_DB_TEST!=="true"){
  throw Error("Este teste só pode usar banco efêmero do GitHub Actions.");
 }
 const sql=postgres(process.env.DATABASE_URL,{ssl:false,max:1});
 let server;let logs="";
 try {
  // Pode executar mesmo se os testes V7 já tiverem preparado as tabelas.
  for(const file of ["sql/001_schema_limpo.sql","sql/002_modulos_v6.sql","sql/003_pedidos_pendentes_v7.sql"]){
   const source=(await fs.readFile(new URL(file,ROOT),"utf8")).replace(/^\s*--.*$/gm,"");
   for(const statement of source.split(";").map(s=>s.trim()).filter(Boolean))await sql.unsafe(statement);
  }
  const hash=await bcrypt.hash("senhaDeTeste2026",10);
  await sql`INSERT INTO loja_usuarios(nome,senha_hash,role)
    VALUES('JuliaTeste',${hash},'gestor'),('AjudanteTeste',${hash},'funcionario')
    ON CONFLICT(nome) DO NOTHING`;

  server=spawn(process.execPath,["src/app.js"],{
   cwd:new URL(".",ROOT),
   env:{...process.env,PORT:String(PORT),DB_SSL:"false",
    SESSION_SECRET:"chave-interna-exclusiva-para-teste-operacao-2026",
    FRONTEND_URL:"http://localhost:5173"},
   stdio:["ignore","pipe","pipe"]
  });
  server.stdout.on("data",d=>{logs+=d.toString();});
  server.stderr.on("data",d=>{logs+=d.toString();});
  let ready=false;
  for(let i=0;i<75;i++){
   if(server.exitCode!==null)throw Error("API interrompida: "+logs);
   try{if((await fetch(URL_BASE+"/health")).ok){ready=true;break;}}catch{}
   await sleep(130);
  }
  assert.ok(ready,"A API não iniciou: "+logs);

  const adminLogin=await api("/api/auth/login",{method:"POST",body:{nome:"JuliaTeste",senha:"senhaDeTeste2026"}});
  const staffLogin=await api("/api/auth/login",{method:"POST",body:{nome:"AjudanteTeste",senha:"senhaDeTeste2026"}});
  assert.equal(adminLogin.status,200,JSON.stringify(adminLogin.data));
  assert.equal(staffLogin.status,200,JSON.stringify(staffLogin.data));
  const admin=adminLogin.data.token,staff=staffLogin.data.token;

  const asStaff=await api("/api/operacao/estoque/alertas",{token:staff});
  assert.equal(asStaff.status,200,"funcionária pode consultar alertas");
  assert.equal((await api("/api/operacao/estoque/alertas")).status,401);
  assert.equal((await api("/api/operacao/financeiro/indicadores",{token:staff})).status,403);
  assert.equal((await api("/api/operacao/exportacao/dados-comerciais",{token:staff})).status,403);
  assert.equal((await api("/api/operacao/financeiro/indicadores?de=2026-02-30&ate=2026-03-03",{token:admin})).status,400);
  assert.equal((await api("/api/operacao/financeiro/indicadores?de=2026-10-30&ate=2026-01-01",{token:admin})).status,400);

  const day=dateLocal();
  const range="?de="+day+"&ate="+day;
  const before=await api("/api/operacao/financeiro/indicadores"+range,{token:admin});
  assert.equal(before.status,200,JSON.stringify(before.data));

  const sku="TEST-OPER-"+Date.now();
  const created=await api("/api/v6/produtos",{method:"POST",token:admin,body:{
   nome:"Blusa operacional",categoria:"Blusas",preco:100,custo:40,
   variantes:[{sku,tamanho:"M",cor:"Azul",quantidade:4,minimo:3}]
  }});
  assert.equal(created.status,201,JSON.stringify(created.data));
  const all=await api("/api/lajustore/produtos",{token:admin});
  assert.equal(all.status,200);
  const product=all.data.find(p=>p.variantes.some(v=>v.sku===sku));
  assert.ok(product);
  const variant=product.variantes.find(v=>v.sku===sku);
  assert.ok(variant);

  const sale=await api("/api/v6/vendas",{method:"POST",token:admin,body:{
   canal:"loja",forma_pagamento:"pix",desconto:0,
   itens:[{variante_id:variant.id,quantidade:2}]
  }});
  assert.equal(sale.status,201,JSON.stringify(sale.data));
  assert.equal(sale.data.total,200);

  const oldDashboard=await api("/api/v6/dashboard",{token:admin});
  assert.equal(oldDashboard.status,200,JSON.stringify(oldDashboard.data));
  const oldReport=await api("/api/v6/relatorios"+range,{token:admin});
  assert.equal(oldReport.status,200,JSON.stringify(oldReport.data));
  assert.ok(oldReport.data.totais.vendas>=1);

  const alerts=await api("/api/operacao/estoque/alertas",{token:admin});
  assert.equal(alerts.status,200,JSON.stringify(alerts.data));
  assert.ok(alerts.data.itens.some(v=>Number(v.variante_id)===Number(variant.id)&&Number(v.quantidade)===2&&Number(v.minimo)===3),JSON.stringify({id:variant.id,itens:alerts.data.itens}));
  assert.ok(alerts.data.total>0);

  const expense=await api("/api/v6/financeiro",{method:"POST",token:admin,body:{
   tipo:"saida",categoria:"aluguel",descricao:"Despesa de teste",valor:15,status:"pago",data_movimento:day
  }});
  assert.equal(expense.status,201,JSON.stringify(expense.data));

  const purchase=await api("/api/v6/compras",{method:"POST",token:admin,body:{
   itens:[{variante_id:variant.id,quantidade:1,custo_unitario:10}]
  }});
  assert.equal(purchase.status,201,JSON.stringify(purchase.data));

  const after=await api("/api/operacao/financeiro/indicadores"+range,{token:admin});
  assert.equal(after.status,200,JSON.stringify(after.data));
  const old=before.data,now=after.data;
  const close=(v,expected,msg)=>assert.ok(Math.abs(v-expected)<0.001,`${msg}: esperado ${expected}, obtido ${v}`);
  close(now.faturamento-old.faturamento,200,"Faturamento");
  close(now.custo_pecas_conhecido-old.custo_pecas_conhecido,80,"Custo da mercadoria vendida");
  close(now.despesas_operacionais-old.despesas_operacionais,15,"Somente despesas operacionais");
  close(now.resultado_operacional_estimado-old.resultado_operacional_estimado,105,"Estimativa operacional");
  close(now.saldo_caixa-old.saldo_caixa,175,"Caixa inclui compra de mercadoria");
  assert.equal(now.pecas_sem_custo,old.pecas_sem_custo);

  const commercial=await api("/api/operacao/exportacao/dados-comerciais",{token:admin});
  assert.equal(commercial.status,200,JSON.stringify(commercial.data));
  assert.equal(commercial.headers.get("cache-control").includes("no-store"),true);
  assert.equal(commercial.data.formato,"lajustore-exportacao-comercial-v1");
  assert.equal(commercial.data.contem_senhas,false);
  assert.equal(commercial.data.restauracao_automatica,false);
  assert.ok(commercial.data.tabelas.loja_produtos.some(p=>p.id===created.data.id));
  assert.ok(commercial.data.tabelas.loja_pedidos.some(p=>p.id===sale.data.id));
  assert.ok(!Object.hasOwn(commercial.data.tabelas,"loja_usuarios"));
  assert.ok(!JSON.stringify(commercial.data).includes("senha_hash"));
 }finally{
  if(server && server.exitCode===null)server.kill("SIGTERM");
  await sql.end();
 }
});
