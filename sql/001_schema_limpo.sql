-- LajuStore: banco NOVO, sem fotografias e sem dados do estoque anterior.
-- Criar o banco vazio antes: CREATE DATABASE lajustore;
CREATE TABLE IF NOT EXISTS loja_usuarios (
 id BIGSERIAL PRIMARY KEY, nome TEXT NOT NULL UNIQUE,
 senha_hash TEXT NOT NULL, role TEXT NOT NULL CHECK(role IN ('gestor','funcionario')),
 ativo BOOLEAN NOT NULL DEFAULT true, criado_em TIMESTAMPTZ NOT NULL DEFAULT NOW()
);
CREATE TABLE IF NOT EXISTS loja_clientes (
 id BIGSERIAL PRIMARY KEY, nome TEXT NOT NULL, telefone TEXT,
 instagram TEXT, criado_em TIMESTAMPTZ NOT NULL DEFAULT NOW()
);
CREATE TABLE IF NOT EXISTS loja_produtos (
 id BIGSERIAL PRIMARY KEY, nome TEXT NOT NULL, descricao TEXT, categoria TEXT,
 preco NUMERIC(12,2) NOT NULL CHECK(preco>=0), custo NUMERIC(12,2) CHECK(custo>=0),
 ativo BOOLEAN NOT NULL DEFAULT true, criado_em TIMESTAMPTZ NOT NULL DEFAULT NOW()
);
CREATE TABLE IF NOT EXISTS loja_variantes (
 id BIGSERIAL PRIMARY KEY, produto_id BIGINT NOT NULL REFERENCES loja_produtos(id),
 sku TEXT NOT NULL UNIQUE, tamanho TEXT NOT NULL, cor TEXT NOT NULL,
 quantidade INTEGER NOT NULL DEFAULT 0 CHECK(quantidade>=0),
 minimo INTEGER NOT NULL DEFAULT 0 CHECK(minimo>=0),
 UNIQUE(produto_id,tamanho,cor)
);
CREATE TABLE IF NOT EXISTS loja_pedidos (
 id BIGSERIAL PRIMARY KEY, cliente_id BIGINT REFERENCES loja_clientes(id),
 canal TEXT NOT NULL CHECK(canal IN ('loja','whatsapp','instagram')),
 status TEXT NOT NULL DEFAULT 'rascunho' CHECK(status IN ('rascunho','pago','cancelado')),
 criado_em TIMESTAMPTZ NOT NULL DEFAULT NOW()
);
CREATE TABLE IF NOT EXISTS loja_pedido_itens (
 id BIGSERIAL PRIMARY KEY, pedido_id BIGINT NOT NULL REFERENCES loja_pedidos(id),
 variante_id BIGINT NOT NULL REFERENCES loja_variantes(id),
 quantidade INTEGER NOT NULL CHECK(quantidade>0),
 preco_unitario NUMERIC(12,2) NOT NULL CHECK(preco_unitario>=0)
);
CREATE TABLE IF NOT EXISTS loja_movimentos (
 id BIGSERIAL PRIMARY KEY, variante_id BIGINT NOT NULL REFERENCES loja_variantes(id),
 pedido_id BIGINT REFERENCES loja_pedidos(id),
 diferenca INTEGER NOT NULL CHECK(diferenca<>0), motivo TEXT NOT NULL,
 criado_em TIMESTAMPTZ NOT NULL DEFAULT NOW()
);
CREATE INDEX IF NOT EXISTS idx_laju_pedidos ON loja_pedidos(status,canal,criado_em);
CREATE INDEX IF NOT EXISTS idx_laju_movimentos ON loja_movimentos(variante_id,criado_em);
