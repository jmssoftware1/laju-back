import test from "node:test";
import assert from "node:assert/strict";
import {centavos,idValido,validarPendente,validarVariacao} from "../src/v7-validacao.js";

test("validação de valores em centavos",()=>{
  assert.equal(centavos("59.90"),5990);
  assert.equal(centavos(0),0);
  assert.equal(centavos(-1),null);
  assert.equal(centavos("1.234"),null);
  assert.equal(centavos(""),null);
});
test("IDs devem ser inteiros positivos",()=>{
  assert.equal(idValido("12"),12);
  assert.equal(idValido(0),null);
  assert.equal(idValido(-1),null);
  assert.equal(idValido("abc"),null);
});
test("pedido pendente mantém canal, cliente e desconto",()=>{
  const d=validarPendente({canal:"instagram",cliente_id:12,desconto:"5.50",observacao:" Retirar na loja ",
    itens:[{variante_id:9,quantidade:2}]});
  assert.equal(d.ok,true);
  assert.equal(d.pedido.desconto_centavos,550);
  assert.equal(d.pedido.canal,"instagram");
  assert.equal(d.pedido.cliente_id,12);
  assert.equal(d.pedido.observacao,"Retirar na loja");
});
test("itens repetidos de um pedido são consolidados",()=>{
  const d=validarPendente({canal:"whatsapp",itens:[{variante_id:2,quantidade:2},{variante_id:2,quantidade:3},{variante_id:1,quantidade:1}]});
  assert.equal(d.ok,true);
  assert.deepEqual(d.pedido.itens,[{variante_id:1,quantidade:1},{variante_id:2,quantidade:5}]);
});
test("não permite pedidos vazios, canal inválido nem quantidade negativa",()=>{
  assert.equal(validarPendente({canal:"web",itens:[{variante_id:1,quantidade:1}]}).ok,false);
  assert.equal(validarPendente({canal:"loja",itens:[]}).ok,false);
  assert.equal(validarPendente({canal:"loja",itens:[{variante_id:1,quantidade:-1}]}).ok,false);
  assert.equal(validarPendente({canal:"loja",itens:[{variante_id:1,quantidade:1.3}]}).ok,false);
  assert.equal(validarPendente({canal:"loja",desconto:-1,itens:[{variante_id:1,quantidade:1}]}).ok,false);
});
test("variação permite SKU, tamanho, cor e estoque mínimo",()=>{
  const valid=validarVariacao({sku:"BLU-PRE-M",tamanho:"M",cor:"Preto",minimo:2});
  assert.equal(valid.ok,true);
  assert.deepEqual(valid.variacao,{sku:"BLU-PRE-M",tamanho:"M",cor:"Preto",minimo:2});
  assert.equal(validarVariacao({sku:"",tamanho:"M",cor:"Preto",minimo:1}).ok,false);
  assert.equal(validarVariacao({sku:"ABC",tamanho:"M",cor:"Preto",minimo:-2}).ok,false);
});
