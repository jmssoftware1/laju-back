-- WARNING: This schema is for context only and is not meant to be run.
-- Table order and constraints may not be valid for execution.

CREATE TABLE public.operadores (
  id_operador integer NOT NULL DEFAULT nextval('operadores_id_operador_seq'::regclass),
  nome character varying NOT NULL UNIQUE,
  status USER-DEFINED NOT NULL,
  pin_hash character varying NOT NULL,
  cargo character varying,
  foto text,
  role character varying NOT NULL DEFAULT 'funcionario'::character varying,
  CONSTRAINT operadores_pkey PRIMARY KEY (id_operador)
);
CREATE TABLE public.movimentos (
  id_movimento integer NOT NULL DEFAULT nextval('movimentos_id_movimento_seq'::regclass),
  codigo character varying NOT NULL,
  nome_produto character varying NOT NULL,
  origem character varying NOT NULL,
  destino character varying NOT NULL,
  tipo USER-DEFINED NOT NULL,
  quantidade integer NOT NULL CHECK (quantidade > 0),
  operador character varying NOT NULL,
  status USER-DEFINED NOT NULL DEFAULT '1'::s_geral,
  data_movimento timestamp with time zone NOT NULL DEFAULT now(),
  CONSTRAINT movimentos_pkey PRIMARY KEY (id_movimento)
);
CREATE TABLE public.produtos (
  id_produto integer NOT NULL DEFAULT nextval('produtos_id_produto_seq'::regclass),
  codigo character varying NOT NULL UNIQUE,
  nome character varying NOT NULL,
  descricao character varying,
  unidade character varying NOT NULL DEFAULT 'un'::character varying,
  status USER-DEFINED NOT NULL DEFAULT '1'::s_geral,
  CONSTRAINT produtos_pkey PRIMARY KEY (id_produto)
);
CREATE TABLE public.categorias (
  id_categoria integer NOT NULL DEFAULT nextval('categorias_id_categoria_seq'::regclass),
  nome character varying NOT NULL UNIQUE,
  status USER-DEFINED NOT NULL DEFAULT '1'::s_geral,
  CONSTRAINT categorias_pkey PRIMARY KEY (id_categoria)
);
CREATE TABLE public.ingredientes (
  id_ingrediente integer NOT NULL DEFAULT nextval('ingredientes_id_ingrediente_seq'::regclass),
  nome character varying NOT NULL,
  id_categoria integer,
  unidade character varying NOT NULL DEFAULT 'kg'::character varying,
  quantidade_atual numeric NOT NULL DEFAULT 0,
  estoque_minimo numeric NOT NULL,
  estoque_critico numeric NOT NULL,
  qtd_compra_normal numeric NOT NULL,
  status USER-DEFINED NOT NULL DEFAULT '1'::s_geral,
  tipo_compra character varying DEFAULT 'mercado'::character varying,
  CONSTRAINT ingredientes_pkey PRIMARY KEY (id_ingrediente),
  CONSTRAINT ingredientes_id_categoria_fkey FOREIGN KEY (id_categoria) REFERENCES public.categorias(id_categoria)
);
CREATE TABLE public.movimentos_ingredientes (
  id_movimento integer NOT NULL DEFAULT nextval('movimentos_ingredientes_id_movimento_seq'::regclass),
  ingrediente_id integer NOT NULL,
  tipo character varying NOT NULL,
  quantidade numeric NOT NULL CHECK (quantidade > 0::numeric),
  operador character varying NOT NULL,
  observacao character varying,
  data_movimento timestamp without time zone NOT NULL DEFAULT now(),
  status USER-DEFINED NOT NULL DEFAULT '1'::s_geral,
  CONSTRAINT movimentos_ingredientes_pkey PRIMARY KEY (id_movimento),
  CONSTRAINT movimentos_ingredientes_ingrediente_id_fkey FOREIGN KEY (ingrediente_id) REFERENCES public.ingredientes(id_ingrediente)
);









-- oque eu criei


-- Limpa movimentações
DELETE FROM movimentos_ingredientes;

-- Limpa ingredientes
DELETE FROM ingredientes;

-- Limpa categorias
DELETE FROM categorias;

-- Mantém só o Muryllo, apaga o resto
DELETE FROM operadores WHERE nome != 'muryllo';

SELECT * FROM categorias;


ALTER TABLE movimentos ALTER COLUMN status SET DEFAULT '1';

-- ─── 1. Vê quais formatos existem na tabela ───────────────────────────────────
SELECT DISTINCT
  CASE
    WHEN data_movimento ~ '^\d{4}-\d{2}-\d{2}' THEN 'ISO (novo)'
    WHEN data_movimento ~ '^\d{2}/\d{2}/\d{4}' THEN 'pt-PT (antigo)'
    ELSE 'desconhecido: ' || data_movimento
  END AS formato,
  COUNT(*) AS total
FROM movimentos
GROUP BY 1;

-- ─── 2. Adiciona coluna temporária já como TIMESTAMP ──────────────────────────
ALTER TABLE movimentos ADD COLUMN data_movimento_nova TIMESTAMP;

-- ─── 3. Converte cada formato para a nova coluna ──────────────────────────────

-- Formato ISO: "2026-05-16T20:15:25.000Z" ou "2026-05-16 20:15:25"
UPDATE movimentos
SET data_movimento_nova = data_movimento::TIMESTAMP
WHERE data_movimento ~ '^\d{4}-\d{2}-\d{2}';

-- Formato pt-PT: "14/05/2026, 11:01:57"
-- Converte manualmente: DD/MM/YYYY, HH:MM:SS → YYYY-MM-DD HH:MM:SS
UPDATE movimentos
SET data_movimento_nova = TO_TIMESTAMP(data_movimento, 'DD/MM/YYYY, HH24:MI:SS')
WHERE data_movimento ~ '^\d{2}/\d{2}/\d{4}';

-- ─── 4. Verifica se ficou algum NULL (registo com formato desconhecido) ────────
SELECT id_movimento, data_movimento
FROM movimentos
WHERE data_movimento_nova IS NULL;
-- Se devolver linhas, há formatos não tratados — avisa antes de continuar!

-- ─── 5. Substitui a coluna antiga pela nova ───────────────────────────────────
ALTER TABLE movimentos DROP COLUMN data_movimento;
ALTER TABLE movimentos RENAME COLUMN data_movimento_nova TO data_movimento;

-- ─── 6. Torna a coluna NOT NULL (agora que todos os valores estão convertidos) -
ALTER TABLE movimentos ALTER COLUMN data_movimento SET NOT NULL;

-- ─── 7. Confirma o resultado final ────────────────────────────────────────────
SELECT column_name, data_type
FROM information_schema.columns
WHERE table_name = 'movimentos' AND column_name = 'data_movimento';

SELECT id_movimento, nome_produto, data_movimento FROM movimentos ORDER BY id_movimento DESC LIMIT 5;


TRUNCATE TABLE movimentos, operadores, produtos RESTART IDENTITY CASCADE;


CREATE TABLE produtos (
  id_produto  SERIAL        PRIMARY KEY,
  codigo      VARCHAR(255)  UNIQUE NOT NULL,  -- código de barras / QR
  nome        VARCHAR(255)  NOT NULL,
  descricao   VARCHAR(500),                   -- opcional
  unidade     VARCHAR(20)   NOT NULL DEFAULT 'un',  -- un, kg, cx, pç…
  status      s_geral       NOT NULL DEFAULT '1'    -- reutiliza o ENUM existente
);


CREATE INDEX idx_produtos_codigo ON produtos (codigo);


SELECT * FROM produtos;
-- Criação dos tipos ENUM (Seguindo o teu modelo de status e funções específicas)
CREATE TYPE t_movimento AS ENUM ('ENTRADA', 'SAIDA');
CREATE TYPE s_geral AS ENUM ('0', '1'); -- 0 = inativo/deletado, 1 = ativo

-- Tabela de Operadores (Adaptada da tua tabela 'usuarios')
CREATE TABLE operadores (
    id_operador SERIAL PRIMARY KEY,
    nome VARCHAR(100) UNIQUE NOT NULL,
    status s_geral NOT NULL
);

select * from operadores;

SELECT * FROM categorias;

SELECT nome, id_categoria FROM ingredientes WHERE status = '1';





UPDATE ingredientes SET unidade = 'Fardo' WHERE unidade = 'fardo';

-- Tabela de Movimentos de Estoque (Adaptada da tua tabela 'perguntas')
CREATE TABLE movimentos(
    id_movimento SERIAL PRIMARY KEY,
    codigo VARCHAR(255) NOT NULL,
    nome_produto VARCHAR(255) NOT NULL,
    origem VARCHAR(255) NOT NULL,
    destino VARCHAR(255) NOT NULL,
    tipo t_movimento NOT NULL,
    quantidade INT NOT NULL CHECK (quantidade > 0), -- Garante que a quantidade não seja zero ou negativa
    operador VARCHAR(100) NOT NULL,
    data_movimento VARCHAR(100) NOT NULL,
    status s_geral NOT NULL
);


ALTER TABLE movimentos 
ALTER COLUMN data_movimento TYPE timestamptz 
USING data_movimento::timestamptz;

ALTER TABLE movimentos 
ALTER COLUMN data_movimento SET DEFAULT NOW();
select * from movimentos;




-- Adiciona o campo pin_hash à tabela operadores
-- VARCHAR(60) é o tamanho exato do hash gerado pelo bcrypt
ALTER TABLE operadores
  ADD COLUMN pin_hash VARCHAR(60);

-- Marca operadores antigos como inativos para forçar novo registo com PIN
-- (opcional — comenta esta linha se quiseres manter os operadores existentes)
UPDATE operadores SET status = '0' WHERE pin_hash IS NULL;

-- Depois de todos os operadores terem PIN, torna o campo obrigatório
ALTER TABLE operadores
  ALTER COLUMN pin_hash SET NOT NULL;

-- Verifica o resultado
SELECT id_operador, nome, pin_hash, status FROM operadores;



-- Adiciona cargo e foto ao operador
ALTER TABLE operadores ADD COLUMN cargo VARCHAR(100);
ALTER TABLE operadores ADD COLUMN foto  TEXT; -- base64 JPEG comprimido

-- Verifica
SELECT id_operador, nome, cargo, foto, status FROM operadores;


ALTER TABLE ingredientes ADD COLUMN tipo_compra VARCHAR(20) DEFAULT 'mercado';
UPDATE operadores SET role = 'gestor' WHERE nome = 'Pedro'
-- ─── Role nos operadores ──────────────────────────────────────────────────────
ALTER TABLE operadores ADD COLUMN IF NOT EXISTS role VARCHAR(20) NOT NULL DEFAULT 'funcionario';
-- Para tornar alguém gestor: UPDATE operadores SET role = 'gestor' WHERE nome = 'João';

-- ─── Categorias de ingredientes ───────────────────────────────────────────────
CREATE TABLE categorias (
  id_categoria SERIAL PRIMARY KEY,
  nome         VARCHAR(100) UNIQUE NOT NULL,
  status       s_geral NOT NULL DEFAULT '1'
);

INSERT INTO categorias (nome) VALUES
  ('Massas'), ('Molhos'), ('Queijos'), ('Carnes'),
  ('Vegetais'), ('Bebidas'), ('Embalagens'), ('Outros');

-- ─── Ingredientes ─────────────────────────────────────────────────────────────
CREATE TABLE ingredientes (
  id_ingrediente    SERIAL PRIMARY KEY,
  nome              VARCHAR(255) NOT NULL,
  id_categoria      INT REFERENCES categorias(id_categoria),
  unidade           VARCHAR(20)  NOT NULL DEFAULT 'kg', -- kg | L | un | g | ml | cx
  quantidade_atual  DECIMAL(10,2) NOT NULL DEFAULT 0,
  estoque_minimo    DECIMAL(10,2) NOT NULL,  -- abaixo → ⚠ Atenção
  estoque_critico   DECIMAL(10,2) NOT NULL,  -- abaixo → 🔴 Urgente
  qtd_compra_normal DECIMAL(10,2) NOT NULL,  -- quantidade que normalmente se compra
  status            s_geral NOT NULL DEFAULT '1'
);

-- ─── Histórico de movimentos ──────────────────────────────────────────────────
CREATE TABLE movimentos_ingredientes (
  id_movimento   SERIAL PRIMARY KEY,
  ingrediente_id INT NOT NULL REFERENCES ingredientes(id_ingrediente),
  tipo           VARCHAR(20) NOT NULL,        -- ENTRADA | SAIDA
  quantidade     DECIMAL(10,2) NOT NULL CHECK (quantidade > 0),
  operador       VARCHAR(100) NOT NULL,
  observacao     VARCHAR(255),
  data_movimento TIMESTAMP NOT NULL DEFAULT NOW(),
  status         s_geral NOT NULL DEFAULT '1'
);

-- ─── Verificar ────────────────────────────────────────────────────────────────
SELECT * FROM categorias;
SELECT * FROM ingredientes;
