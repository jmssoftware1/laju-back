import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs/promises";
import {spawn} from "node:child_process";
import postgres from "postgres";
import bcrypt from "bcrypt";

const ROOT = new URL("../",import.meta.url);
const PORT = 43197;
const HOST = `http://127.0.0.1:${PORT}`;
const sleep = ms=>new Promise(resolve=>setTimeout(resolve,ms));

async function request(path,{method="GET",body,token}={}) {
  const response=await fetch(HOST+path,{method,headers:{
    ...(body!==undefined?{"Content-Type":"application/json"}:{}),
    ...(token?{Authorization:`Bearer ${token}`}:{})
  },body:body===undefined?undefined:JSON.stringify(body)});
  const data=await response.json();
  return {status:response.status,data};
}

test("V7 pedidos, estoque, permissão e financeiro (PostgreSQL temporário)",{timeout:60000},async()=>{
  if(!process.env.DATABASE_URL || process.env.CI_DB_TEST !== "true")
    throw Error("Este teste só deve rodar no banco de testes efêmero CI_DB_TEST=true");

  const sql=postgres(process.env.DATABASE_URL,{ssl:false,max:1});
  let server;
  let logs="";
  try {
    for(const filename of ["sql/001_schema_limpo.sql","sql/002_modulos_v6.sql","sql/003_pedidos_pendentes_v7.sql"]){
      const source=(await fs.readFile(new URL(filename,ROOT),"utf8")).replace(/^\s*--.*$/gm,"");
      for(const raw of source.split(";")){
        const statement=raw.trim();
        if(statement)await sql.unsafe(statement);
      }
    }
    const hash=await bcrypt.hash("senhaDeTeste2026",10);
    await sql`INSERT INTO loja_usuarios(nome,senha_hash,role)
      VALUES('JuliaTeste',${hash},'gestor'),('AjudanteTeste',${hash},'funcionario')`;
    server=spawn(process.execPath,["src/app.js"],{
      cwd:new URL(".",ROOT),
      env:{...process.env,PORT:String(PORT),DB_SSL:"false",SESSION_SECRET:"segredo-exclusivo-testes-v7-1234567890",FRONTEND_URL:"http://localhost:5173"},
      stdio:["ignore","pipe","pipe"]
    });
    server.stdout.on("data",chunk=>{logs+=chunk.toString();});
    server.stderr.on("data",chunk=>{logs+=chunk.toString();});
    let ready=false;
    for(let i=0;i<70;i++){
      if(server.exitCode!==null)throw Error("Servidor encerrou: "+logs);
      try{const health=await fetch(HOST+"/health");if(health.ok){ready=true;break;}}catch{}
      await sleep(150);
    }
    assert.ok(ready,"API não iniciou: "+logs);

    const loginAdm=await request("/api/auth/login",{method:"POST",body:{nome:"JuliaTeste",senha:"senhaDeTeste2026"}});
    assert.equal(loginAdm.status,200,JSON.stringify(loginAdm.data));
    const admin=loginAdm.data.token;
    const loginStaff=await request("/api/auth/login",{method:"POST",body:{nome:"AjudanteTeste",senha:"senhaDeTeste2026"}});
    assert.equal(loginStaff.status,200);
    const staff=loginStaff.data.token;

    const cadastro=await request("/api/v6/produtos",{method:"POST",token:admin,body:{
      nome:"Blusa de teste",categoria:"Blusas",preco:49.90,custo:20,
      variantes:[{sku:"BLU-M-PRE",tamanho:"M",cor:"Preto",quantidade:10,minimo:2}]
    }});
    assert.equal(cadastro.status,201,JSON.stringify(cadastro.data));
    const all=await request("/api/lajustore/produtos",{token:admin});
    const v=all.data.find(p=>p.nome==="Blusa de teste").variantes[0];

    const pending=await request("/api/v7/pendentes",{method:"POST",token:staff,body:{
      canal:"instagram",desconto:5.50,
      itens:[{variante_id:v.id,quantidade:2}],
      observacao:"Separar para retirada"
    }});
    assert.equal(pending.status,201,JSON.stringify(pending.data));
    const pedidoId=pending.data.id;
    assert.equal(pending.data.total,94.3);

    const list=await request("/api/v7/pendentes",{token:staff});
    assert.equal(list.status,200);
    assert.equal(list.data.length,1);
    assert.equal(list.data[0].itens[0].saldo_atual,10);
    let [stock]=await sql`SELECT quantidade FROM loja_variantes WHERE id=${v.id}`;
    assert.equal(stock.quantidade,10,"pendente não reduz estoque");

    const legacy=await request(`/api/lajustore/pedidos/${pedidoId}/concluir`,{method:"POST",token:staff,body:{}});
    assert.equal(legacy.status,409,"API antiga deve rejeitar pendentes V7");

    const done=await request(`/api/v7/pendentes/${pedidoId}/concluir`,{method:"POST",token:staff,body:{forma_pagamento:"pix"}});
    assert.equal(done.status,200,JSON.stringify(done.data));
    assert.equal(done.data.total,94.3);
    const retry=await request(`/api/v7/pendentes/${pedidoId}/concluir`,{method:"POST",token:staff,body:{forma_pagamento:"pix"}});
    assert.equal(retry.status,200);
    assert.equal(retry.data.ja_concluido,true);
    [stock]=await sql`SELECT quantidade FROM loja_variantes WHERE id=${v.id}`;
    assert.equal(stock.quantidade,8);

    const fin=await sql`SELECT valor FROM loja_financeiro WHERE pedido_id=${pedidoId} AND tipo='entrada'`;
    assert.equal(fin.length,1,"não pode duplicar entrada financeira");
    assert.equal(Number(fin[0].valor),94.3);

    const updateByStaff=await request(`/api/v7/variantes/${v.id}`,{method:"PATCH",token:staff,body:{
      sku:"BLU-M-PRE-NOVO",tamanho:"M",cor:"Preto",minimo:3
    }});
    assert.equal(updateByStaff.status,403);
    const update=await request(`/api/v7/variantes/${v.id}`,{method:"PATCH",token:admin,body:{
      sku:"BLU-M-PRE-NOVO",tamanho:"M",cor:"Preto",minimo:3
    }});
    assert.equal(update.status,200,JSON.stringify(update.data));
    assert.equal(update.data.quantidade,8,"edição não altera saldo");

    const later=await request("/api/v7/pendentes",{method:"POST",token:staff,body:{
      canal:"whatsapp",itens:[{variante_id:v.id,quantidade:8}]
    }});
    assert.equal(later.status,201,JSON.stringify(later.data));
    const sale=await request("/api/v6/vendas",{method:"POST",token:staff,body:{
      canal:"loja",forma_pagamento:"pix",desconto:0,
      itens:[{variante_id:v.id,quantidade:2}]
    }});
    assert.equal(sale.status,201,JSON.stringify(sale.data));
    const insufficient=await request(`/api/v7/pendentes/${later.data.id}/concluir`,{method:"POST",token:staff,body:{forma_pagamento:"pix"}});
    assert.equal(insufficient.status,409,"não deve vender sem saldo");
    [stock]=await sql`SELECT quantidade FROM loja_variantes WHERE id=${v.id}`;
    assert.equal(stock.quantidade,6,"falha deve reverter transação");

    const nonAdmin=await request(`/api/v7/pendentes/${later.data.id}/cancelar`,{method:"POST",token:staff,body:{}});
    assert.equal(nonAdmin.status,403);
    const cancel=await request(`/api/v7/pendentes/${later.data.id}/cancelar`,{method:"POST",token:admin,body:{}});
    assert.equal(cancel.status,200,JSON.stringify(cancel.data));
    [stock]=await sql`SELECT quantidade FROM loja_variantes WHERE id=${v.id}`;
    assert.equal(stock.quantidade,6,"cancelamento de pendente não movimenta estoque");

    const audit=await sql`SELECT operacao FROM loja_auditoria_v7 WHERE registro_id=${pedidoId} AND entidade='pedido'`;
    assert.deepEqual(audit.map(x=>x.operacao).sort(),["confirmado","criado_pendente"]);
  } finally {
    if(server && server.exitCode===null)server.kill("SIGTERM");
    await sql.end();
  }
});
