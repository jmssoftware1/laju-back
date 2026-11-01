export const CANAIS = new Set(["loja", "whatsapp", "instagram"]);
export const PAGAMENTOS = new Set(["pix", "dinheiro", "debito", "credito", "outro"]);

export function idValido(v) {
  const n = Number(v);
  return Number.isSafeInteger(n) && n > 0 ? n : null;
}

export function inteiroNaoNegativo(v, max=100000) {
  if (v === "" || v === null || v === undefined) return null;
  const n = Number(v);
  return Number.isSafeInteger(n) && n >= 0 && n <= max ? n : null;
}

export function centavos(v) {
  if (v === "" || v === null || v === undefined) return null;
  const n = Number(v);
  if (!Number.isFinite(n) || n < 0 || n > 99999999) return null;
  const cents = Math.round(n * 100);
  return Math.abs(n * 100 - cents) < 0.00001 ? cents : null;
}

export function texto(v, limite=500) {
  return typeof v === "string" ? v.trim().slice(0, limite) : "";
}

export function validarPendente(data) {
  if (!data || !CANAIS.has(data.canal)) return {ok:false, mensagem:"Canal de venda inválido"};
  if (data.cliente_id != null && idValido(data.cliente_id) === null)
    return {ok:false,mensagem:"Cliente inválido"};
  const desconto = centavos(data.desconto ?? 0);
  if (desconto === null) return {ok:false,mensagem:"Desconto inválido"};
  if (!Array.isArray(data.itens) || data.itens.length === 0 || data.itens.length > 80)
    return {ok:false,mensagem:"Selecione entre 1 e 80 itens"};
  const itens = new Map();
  for (const item of data.itens) {
    const variantId = idValido(item?.variante_id);
    const qtd = idValido(item?.quantidade);
    if (!variantId || !qtd || qtd > 100000)
      return {ok:false,mensagem:"Peça ou quantidade inválida"};
    const nova = (itens.get(variantId) ?? 0) + qtd;
    if (nova > 100000) return {ok:false,mensagem:"Quantidade acima do limite"};
    itens.set(variantId,nova);
  }
  return {
    ok:true,
    pedido:{
      cliente_id:data.cliente_id == null ? null : idValido(data.cliente_id),
      canal:data.canal,
      desconto_centavos:desconto,
      observacao:texto(data.observacao,600) || null,
      itens:[...itens].sort((a,b)=>a[0]-b[0]).map(([variante_id,quantidade])=>({variante_id,quantidade}))
    }
  };
}

export function validarVariacao(data) {
  if (!data) return {ok:false,mensagem:"Variação inválida"};
  const sku = texto(data.sku,80), tamanho = texto(data.tamanho,30),
    cor = texto(data.cor,80), minimo=inteiroNaoNegativo(data.minimo,100000);
  if (!sku || !tamanho || !cor || minimo === null)
    return {ok:false,mensagem:"Preencha SKU, tamanho, cor e mínimo válido"};
  return {ok:true,variacao:{sku,tamanho,cor,minimo}};
}
