-- LajuStore V6 — atualização incremental (executar NO Supabase SQL Editor).
-- Preserva todo o estoque, usuários e pedidos já existentes.
BEGIN;

ALTER TABLE public.loja_pedido_itens
  ADD COLUMN IF NOT EXISTS custo_unitario NUMERIC(12,2);
ALTER TABLE public.loja_pedidos
  ADD COLUMN IF NOT EXISTS desconto NUMERIC(12,2) NOT NULL DEFAULT 0,
  ADD COLUMN IF NOT EXISTS forma_pagamento TEXT,
  ADD COLUMN IF NOT EXISTS observacao TEXT,
  ADD COLUMN IF NOT EXISTS finalizado_em TIMESTAMPTZ,
  ADD COLUMN IF NOT EXISTS criado_por BIGINT REFERENCES public.loja_usuarios(id);

CREATE TABLE IF NOT EXISTS public.loja_fornecedores (
 id BIGSERIAL PRIMARY KEY,
 nome TEXT NOT NULL,
 telefone TEXT,
 email TEXT,
 observacao TEXT,
 ativo BOOLEAN NOT NULL DEFAULT true,
 criado_em TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE TABLE IF NOT EXISTS public.loja_compras (
 id BIGSERIAL PRIMARY KEY,
 fornecedor_id BIGINT REFERENCES public.loja_fornecedores(id),
 observacao TEXT,
 total NUMERIC(12,2) NOT NULL CHECK(total >= 0),
 criado_em TIMESTAMPTZ NOT NULL DEFAULT NOW(),
 registrado_por BIGINT REFERENCES public.loja_usuarios(id)
);

CREATE TABLE IF NOT EXISTS public.loja_compra_itens (
 id BIGSERIAL PRIMARY KEY,
 compra_id BIGINT NOT NULL REFERENCES public.loja_compras(id),
 variante_id BIGINT NOT NULL REFERENCES public.loja_variantes(id),
 quantidade INTEGER NOT NULL CHECK(quantidade > 0),
 custo_unitario NUMERIC(12,2) NOT NULL CHECK(custo_unitario >= 0)
);

CREATE TABLE IF NOT EXISTS public.loja_financeiro (
 id BIGSERIAL PRIMARY KEY,
 tipo TEXT NOT NULL CHECK(tipo IN ('entrada','saida')),
 categoria TEXT NOT NULL,
 descricao TEXT NOT NULL,
 valor NUMERIC(12,2) NOT NULL CHECK(valor > 0),
 status TEXT NOT NULL DEFAULT 'pago' CHECK(status IN ('pago','pendente')),
 data_movimento DATE NOT NULL DEFAULT CURRENT_DATE,
 pedido_id BIGINT REFERENCES public.loja_pedidos(id),
 compra_id BIGINT REFERENCES public.loja_compras(id),
 criado_em TIMESTAMPTZ NOT NULL DEFAULT NOW(),
 registrado_por BIGINT REFERENCES public.loja_usuarios(id)
);

CREATE INDEX IF NOT EXISTS idx_laju_financeiro_data
 ON public.loja_financeiro(data_movimento DESC, id DESC);
CREATE INDEX IF NOT EXISTS idx_laju_compras_data
 ON public.loja_compras(criado_em DESC);
CREATE INDEX IF NOT EXISTS idx_laju_pedidos_data
 ON public.loja_pedidos(criado_em DESC);

COMMIT;
