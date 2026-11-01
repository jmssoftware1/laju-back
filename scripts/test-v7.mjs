import assert from "node:assert/strict";
import {readFileSync} from "node:fs";
import {spawn} from "node:child_process";
import postgres from "postgres";
import bcrypt from "bcrypt";
import {signSession} from "../src/session.js";

const sql=postgres(process.env.DATABASE_URL,{max:2,ssl:false});
const port=Number(process.env.PORT||39001);
const base=`http://127.0.0.1:${port}`;
let server;
let logs="";
const sleep=ms=>new Promise(resolve=>setTimeout(resolve,ms));

async function request(route,method="GET",body,token){
 const response=await fetch(base+route,{
  method,
  headers:{"Content-Type":"application/json",...(token?{Authorization:`Bearer ${token}`}:{})},
  ...(body===undefined?{}:{body:JSON.stringify(body)})
 });
 const result=await response.json();
 return {status:response.status,data:result};
}
function expectStatus(res,code){
 assert.equal(res.status,code,`Esperado HTTP ${code}, recebido ${res.status}: ${JSON.stringify(res.data)}`);
 return res.data;
}
async function prepare(){
 for(const filename of ["sql/001_schema_limpo.sql","sql/002_modulos_v6.sql"]){
  const script=readFileSync(filename,"utf8").replace(/^\s*--.*$/gm,"");
  for(const part of script.split(";").map(x=>x.trim()).filter(Boolean)){
   if(/^(BEGIN|COMMIT)$/i.test(part))continue;
   await sql.unsafe(part);
  }
 }
 const gestorHash=await bcrypt.hash("admin-teste-nao-real-987654",10);
 const [gestor]=await sql`INSERT INTO loja_usuarios(nome,senha_hash,role)
 VALUES('TesteGestor',${gestorHash},'gestor') RETURNING id`;
 const staffHash=await bcrypt.hash("funcionario-teste-nao-real-12345",10);
 const [staff]=await sql`INSERT INTO loja_usuarios(nome,senha_hash,role)
 VALUES('TesteFuncionaria',${staffHash},'funcionario') RETURNING id`;
 return {
  admin:signSession({id_operador:Number(gestor.id),role:"gestor"}),
  staff:signSession({id_operador:Number(staff.id),role:"funcionario"})
 };
}
async function boot(){
 server=spawn(process.execPath,["src/app.js"],{env:{...process.env,PORT:String(port)},stdio:["ignore","pipe","pipe"]});
 server.stdout.on("data",chunk=>{logs+=chunk;});
 server.stderr.on("data",chunk=>{logs+=chunk;});
 for(let i=0;i<70;i++){
  if(server.exitCode!==null)throw Error(`Servidor terminou: ${logs.slice(-1500)}`);
  try{const h=await fetch(base+"/health");if(h.ok)return;}catch{}
  await sleep(150);
 }
 throw Error(`Servidor não respondeu: ${logs.slice(-1500)}`);
}

try{
 const {admin,staff}=await prepare();
 await boot();

 expectStatus(await request("/api/v7/pendentes"),401);
 const prod=expectStatus(await request("/api/v6/produtos","POST",{
  nome:"Blusa Teste CI",categoria:"Blusas",preco:50,custo:20,
  variantes:[{sku:"V7-TESTE-M-PRETA",tamanho:"M",cor:"Preto",quantidade:10,minimo:2}]
 },admin),201);
 const [variant]=await sql`SELECT id,quantidade FROM loja_variantes WHERE produto_id=${prod.id}`;
 assert.equal(variant.quantidade,10);

 const pending=expectStatus(await request("/api/v7/pendentes","POST",{
  canal:"instagram",desconto:10,
  itens:[{variante_id:Number(variant.id),quantidade:2}],
  observacao:"Cliente aguardando Pix"
 },admin),201);
 assert.equal(pending.status,"rascunho");
 assert.equal(pending.total,90);
 let [saldo]=await sql`SELECT quantidade FROM loja_variantes WHERE id=${variant.id}`;
 assert.equal(saldo.quantidade,10,"Pendentes não devem baixar o estoque");
 let [fin]=await sql`SELECT COUNT(*)::int AS total FROM loja_financeiro`;
 assert.equal(fin.total,0,"Pendentes não devem criar recebíveis pagos");
 const list=expectStatus(await request("/api/v7/pendentes","GET",undefined,admin),200);
 assert.equal(list.length,1);
 assert.equal(list[0].itens[0].quantidade,2);
 // Um pedido criado dois dias antes deve entrar no relatório do dia do pagamento.
 await sql`UPDATE loja_pedidos SET criado_em=NOW() - interval '2 days' WHERE id=${pending.id}`;

 const completed=expectStatus(await request(`/api/v7/pendentes/${pending.id}/concluir`,"POST",{forma_pagamento:"pix"},admin),200);
 assert.equal(completed.status,"pago");assert.equal(completed.total,90);
 [saldo]=await sql`SELECT quantidade FROM loja_variantes WHERE id=${variant.id}`;
 assert.equal(saldo.quantidade,8);
 [fin]=await sql`SELECT COUNT(*)::int AS total,COALESCE(SUM(valor),0) AS amount FROM loja_financeiro WHERE pedido_id=${pending.id}`;
 assert.equal(fin.total,1);assert.equal(Number(fin.amount),90);
 expectStatus(await request(`/api/v7/pendentes/${pending.id}/concluir`,"POST",{forma_pagamento:"pix"},admin),409);
 [fin]=await sql`SELECT COUNT(*)::int AS total FROM loja_financeiro WHERE pedido_id=${pending.id}`;
 assert.equal(fin.total,1,"Não pode lançar financeiro duas vezes");

 const today=new Date().toISOString().slice(0,10);
 const rel=expectStatus(await request(`/api/v6/relatorios?de=${today}&ate=${today}`,"GET",undefined,admin),200);
 assert.equal(rel.totais.vendas,1);
 assert.equal(Number(rel.totais.faturamento),90);

 expectStatus(await request(`/api/v7/variantes/${variant.id}`,"PATCH",{
  sku:"V7-TESTE-M-BLACK",tamanho:"M",cor:"Preto",minimo:3
 },staff),403);
 const edited=expectStatus(await request(`/api/v7/variantes/${variant.id}`,"PATCH",{
  sku:"V7-TESTE-M-BLACK",tamanho:"M",cor:"Preto",minimo:3
 },admin),200);
 assert.equal(edited.minimo,3);assert.equal(edited.quantidade,8);

 const pending2=expectStatus(await request("/api/v7/pendentes","POST",{
  canal:"whatsapp",desconto:0,itens:[{variante_id:Number(variant.id),quantidade:8}]
 },staff),201);
 expectStatus(await request("/api/v6/vendas","POST",{
  canal:"loja",forma_pagamento:"dinheiro",desconto:0,
  itens:[{variante_id:Number(variant.id),quantidade:1}]
 },admin),201);
 expectStatus(await request(`/api/v7/pendentes/${pending2.id}/concluir`,"POST",{forma_pagamento:"pix"},admin),409);
 [saldo]=await sql`SELECT quantidade FROM loja_variantes WHERE id=${variant.id}`;
 assert.equal(saldo.quantidade,7,"Falha por estoque insuficiente não pode baixar novamente");
 expectStatus(await request(`/api/v7/pendentes/${pending2.id}/cancelar`,"POST",{},staff),403);
 expectStatus(await request(`/api/v7/pendentes/${pending2.id}/cancelar`,"POST",{},admin),200);
 const [cancelled]=await sql`SELECT status FROM loja_pedidos WHERE id=${pending2.id}`;
 assert.equal(cancelled.status,"cancelado");
 [saldo]=await sql`SELECT quantidade FROM loja_variantes WHERE id=${variant.id}`;
 assert.equal(saldo.quantidade,7,"Cancelamento de pendente não deve alterar estoque");

 console.log("✅ V7 integração: autenticação, criação de pendente, pagamento, estoque, financeiro, relatórios, variação, concorrência e cancelamento.");
} catch(e) {
 console.error("❌ Teste de integração V7:",e);
 console.error("Logs da API:",logs.slice(-2000));
 process.exitCode=1;
} finally {
 if(server && server.exitCode===null)server.kill("SIGTERM");
 await sql.end();
}
