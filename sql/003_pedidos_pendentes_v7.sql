-- LajuStore V7 — executar no projeto Supabase existente APÓS backup.
-- ALTERA somente o esquema, nunca limpa dados e mantém compatibilidade com V6.
BEGIN;

ALTER TABLE public.loja_pedidos
  ADD COLUMN IF NOT EXISTS origem_fluxo TEXT NOT NULL DEFAULT 'legado';

CREATE INDEX IF NOT EXISTS idx_laju_v7_pedidos_pendentes
  ON public.loja_pedidos(criado_em DESC, id DESC)
  WHERE status = 'rascunho' AND origem_fluxo = 'v7_pendente';

CREATE TABLE IF NOT EXISTS public.loja_auditoria_v7 (
  id BIGSERIAL PRIMARY KEY,
  usuario_id BIGINT REFERENCES public.loja_usuarios(id),
  entidade TEXT NOT NULL,
  registro_id BIGINT NOT NULL,
  operacao TEXT NOT NULL,
  detalhes JSONB NOT NULL DEFAULT '{}'::jsonb,
  criado_em TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_laju_v7_auditoria_registro
  ON public.loja_auditoria_v7(entidade, registro_id, criado_em DESC);

COMMIT;
