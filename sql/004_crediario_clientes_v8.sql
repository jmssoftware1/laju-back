-- LajuStore V8 — Contas de clientes / crediário.
-- Rodar UMA vez no SQL Editor do Supabase após um backup, ANTES de publicar a API V8.
-- Migração incremental: não apaga nem altera pedidos/usuários anteriores.
BEGIN;

CREATE TABLE IF NOT EXISTS public.loja_crediario (
 id BIGSERIAL PRIMARY KEY,
 pedido_id BIGINT NOT NULL UNIQUE REFERENCES public.loja_pedidos(id),
 cliente_id BIGINT NOT NULL REFERENCES public.loja_clientes(id),
 total NUMERIC(12,2) NOT NULL CHECK (total > 0),
 status TEXT NOT NULL DEFAULT 'aberto'
   CHECK (status IN ('aberto','quitado','cancelado')),
 observacao TEXT,
 criado_em TIMESTAMPTZ NOT NULL DEFAULT NOW(),
 registrado_por BIGINT REFERENCES public.loja_usuarios(id)
);

CREATE TABLE IF NOT EXISTS public.loja_crediario_parcelas (
 id BIGSERIAL PRIMARY KEY,
 crediario_id BIGINT NOT NULL REFERENCES public.loja_crediario(id),
 numero SMALLINT NOT NULL CHECK (numero BETWEEN 1 AND 6),
 valor NUMERIC(12,2) NOT NULL CHECK (valor > 0),
 vencimento DATE NOT NULL,
 UNIQUE(crediario_id,numero)
);

CREATE TABLE IF NOT EXISTS public.loja_crediario_pagamentos (
 id BIGSERIAL PRIMARY KEY,
 crediario_id BIGINT NOT NULL REFERENCES public.loja_crediario(id),
 valor NUMERIC(12,2) NOT NULL CHECK (valor > 0),
 forma_pagamento TEXT NOT NULL CHECK (
  forma_pagamento IN ('pix','dinheiro','debito','credito','outro')
 ),
 observacao TEXT,
 chave_operacao TEXT NOT NULL UNIQUE CHECK (length(chave_operacao) BETWEEN 10 AND 100),
 recebido_em TIMESTAMPTZ NOT NULL DEFAULT NOW(),
 registrado_por BIGINT REFERENCES public.loja_usuarios(id),
 financeiro_id BIGINT NOT NULL UNIQUE REFERENCES public.loja_financeiro(id)
);

CREATE INDEX IF NOT EXISTS idx_laju_crediario_cliente
 ON public.loja_crediario(cliente_id,status,id DESC);
CREATE INDEX IF NOT EXISTS idx_laju_crediario_vencimentos
 ON public.loja_crediario_parcelas(crediario_id,vencimento);
CREATE INDEX IF NOT EXISTS idx_laju_crediario_pagamentos
 ON public.loja_crediario_pagamentos(crediario_id,recebido_em);

-- Bloqueia acesso direto a dados pessoais/financeiros pelo PostgREST
-- do Supabase (anon/authenticated). O backend, conectado como dono do
-- banco, continua atendendo apenas as sessões gestoras autorizadas.
ALTER TABLE public.loja_crediario ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.loja_crediario_parcelas ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.loja_crediario_pagamentos ENABLE ROW LEVEL SECURITY;

COMMIT;
