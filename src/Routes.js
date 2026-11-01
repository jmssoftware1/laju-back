import express from "express";
import bcrypt from "bcrypt";
import sql from "./bd.js";
import { signSession } from "./session.js";

const routes = express.Router();
const SALT_ROUNDS = 10;

function validarPin(pin) {
  return /^\d{4}$/.test(pin);
}

// ─── Auth ─────────────────────────────────────────────────────────────────────
routes.post("/login", async (req, res) => {
  const { nome, pin } = req.body;
  if (!nome?.trim() || !validarPin(pin))
    return res.status(400).json({ mensagem: "Nome ou PIN inválido" });
  try {
    const [op] = await sql`
      SELECT id_operador, nome, pin_hash, status, cargo, foto, role
      FROM operadores WHERE nome = ${nome.trim()} AND status = '1'
    `;
    if (!op || !(await bcrypt.compare(pin, op.pin_hash)))
      return res.status(401).json({ mensagem: "Nome ou PIN incorretos" });
    return res.status(200).json({
      token: signSession(op),
      operador: {
        id_operador: op.id_operador,
        nome: op.nome,
        status: op.status,
        cargo: op.cargo ?? null,
        foto: op.foto ?? null,
        role: op.role ?? "funcionario",
      },
    });
  } catch (e) {
    console.error(e);
    return res.status(500).json({ mensagem: "Erro inesperado" });
  }
});

routes.post("/operador", async (req, res) => {
  const { nome, pin } = req.body;
  if (!nome?.trim())
    return res.status(400).json({ mensagem: "Nome obrigatório" });
  if (!validarPin(pin))
    return res.status(400).json({ mensagem: "PIN deve ter 4 dígitos" });
  try {
    const existe =
      await sql`SELECT id_operador FROM operadores WHERE nome = ${nome.trim()}`;
    if (existe.length > 0)
      return res.status(409).json({ mensagem: "Operador já cadastrado" });
    const pin_hash = await bcrypt.hash(pin, SALT_ROUNDS);
    await sql`INSERT INTO operadores (nome, pin_hash, status, role) VALUES (${nome.trim()}, ${pin_hash}, '1', 'funcionario')`;
    return res.status(201).json({ mensagem: "Operador criado com sucesso" });
  } catch (e) {
    console.error(e);
    return res.status(500).json({ mensagem: "Erro inesperado" });
  }
});

routes.get("/operadores/:id", async (req, res) => {
  try {
    const [op] =
      await sql`SELECT id_operador, nome, cargo, foto, role, status FROM operadores WHERE id_operador = ${req.params.id} AND status = '1'`;
    if (!op) return res.status(404).json({ mensagem: "Não encontrado" });
    return res.status(200).json(op);
  } catch (e) {
    console.error(e);
    return res.status(500).json({ mensagem: "Erro inesperado" });
  }
});

// Lista TODOS os operadores (ativos e inativos) — uso exclusivo da tela Admin
routes.get("/operadores", async (_, res) => {
  try {
    const r = await sql`
      SELECT id_operador, nome, cargo, foto, role, status
      FROM operadores
      ORDER BY status DESC, nome
    `;
    return res.status(200).json(r);
  } catch (e) {
    console.error(e);
    return res.status(500).json({ mensagem: "Erro inesperado" });
  }
});

routes.put("/operadores/:id", async (req, res) => {
  try {
    const { nome, cargo, foto, role } = req.body;
    if (!nome?.trim())
      return res.status(400).json({ mensagem: "Nome obrigatório" });
    if (role && !["funcionario", "gestor"].includes(role))
      return res.status(400).json({ mensagem: "Role inválida" });
    // Sem filtro de status: permite corrigir dados de um operador já desativado
    const [upd] = await sql`
      UPDATE operadores SET
        nome=${nome.trim()}, cargo=${cargo ?? null}, foto=${foto ?? null},
        role=${role ?? sql`role`}
      WHERE id_operador=${req.params.id}
      RETURNING id_operador, nome, cargo, foto, role, status
    `;
    if (!upd) return res.status(404).json({ mensagem: "Não encontrado" });
    return res.status(200).json(upd);
  } catch (e) {
    console.error(e);
    return res.status(500).json({ mensagem: "Erro inesperado" });
  }
});

// Ativar / desativar operador (soft delete — preserva o histórico de movimentações)
routes.put("/operadores/:id/status", async (req, res) => {
  try {
    const { status } = req.body;
    if (!["0", "1"].includes(status))
      return res.status(400).json({ mensagem: "Status inválido" });
    const [upd] = await sql`
      UPDATE operadores SET status=${status}
      WHERE id_operador=${req.params.id}
      RETURNING id_operador, nome, cargo, foto, role, status
    `;
    if (!upd) return res.status(404).json({ mensagem: "Não encontrado" });
    return res.status(200).json(upd);
  } catch (e) {
    console.error(e);
    return res.status(500).json({ mensagem: "Erro inesperado" });
  }
});

// Redefinir PIN de um operador (uso do gestor — ex: ao reativar alguém)
routes.put("/operadores/:id/pin", async (req, res) => {
  try {
    const { pin } = req.body;
    if (!validarPin(pin))
      return res.status(400).json({ mensagem: "PIN deve ter 4 dígitos" });
    const pin_hash = await bcrypt.hash(pin, SALT_ROUNDS);
    const [upd] = await sql`
      UPDATE operadores SET pin_hash=${pin_hash}
      WHERE id_operador=${req.params.id}
      RETURNING id_operador
    `;
    if (!upd) return res.status(404).json({ mensagem: "Não encontrado" });
    return res.status(200).json({ mensagem: "PIN redefinido com sucesso" });
  } catch (e) {
    console.error(e);
    return res.status(500).json({ mensagem: "Erro inesperado" });
  }
});

// ─── Categorias ───────────────────────────────────────────────────────────────

routes.get("/categorias", async (_, res) => {
  try {
    const r =
      await sql`SELECT * FROM categorias WHERE status = '1' ORDER BY nome`;
    return res.status(200).json(r);
  } catch (e) {
    console.error(e);
    return res.status(500).json({ mensagem: "Erro inesperado" });
  }
});

// ─── Ingredientes ─────────────────────────────────────────────────────────────

routes.get("/ingredientes", async (_, res) => {
  try {
    const r = await sql`
      SELECT i.*, c.nome AS categoria_nome
      FROM ingredientes i
      LEFT JOIN categorias c ON c.id_categoria = i.id_categoria
      WHERE i.status = '1'
      ORDER BY c.nome, i.nome
    `;
    return res.status(200).json(r);
  } catch (e) {
    console.error(e);
    return res.status(500).json({ mensagem: "Erro inesperado" });
  }
});

routes.get("/ingredientes/:id", async (req, res) => {
  try {
    const [i] = await sql`
      SELECT i.*, c.nome AS categoria_nome FROM ingredientes i
      LEFT JOIN categorias c ON c.id_categoria = i.id_categoria
      WHERE i.id_ingrediente = ${req.params.id} AND i.status = '1'
    `;
    if (!i) return res.status(404).json({ mensagem: "Não encontrado" });
    return res.status(200).json(i);
  } catch (e) {
    console.error(e);
    return res.status(500).json({ mensagem: "Erro inesperado" });
  }
});

routes.post("/ingredientes", async (req, res) => {
  try {
    const {
      nome,
      id_categoria,
      unidade,
      estoque_minimo,
      estoque_critico,
      qtd_compra_normal,
      tipo_compra // <-- ADICIONADO AQUI
    } = req.body;
    if (
      !nome?.trim() ||
      !unidade ||
      estoque_minimo == null ||
      estoque_critico == null ||
      qtd_compra_normal == null
    )
      return res.status(400).json({ mensagem: "Campos obrigatórios em falta" });
    
    // Na query abaixo adicionamos tipo_compra no INSERT e no VALUES
    const [novo] = await sql`
      INSERT INTO ingredientes (nome, id_categoria, unidade, quantidade_atual, estoque_minimo, estoque_critico, qtd_compra_normal, tipo_compra, status)
      VALUES (${nome.trim()}, ${id_categoria ?? null}, ${unidade}, 0, ${estoque_minimo}, ${estoque_critico}, ${qtd_compra_normal}, ${tipo_compra ?? 'mercado'}, '1')
      RETURNING *
    `;
    return res.status(201).json(novo);
  } catch (e) {
    console.error(e);
    return res.status(500).json({ mensagem: "Erro inesperado" });
  }
});

routes.put("/ingredientes/:id", async (req, res) => {
  try {
    const {
      nome,
      id_categoria,
      unidade,
      estoque_minimo,
      estoque_critico,
      qtd_compra_normal,
      tipo_compra // <-- ADICIONADO AQUI
    } = req.body;
    
    // Na query abaixo adicionamos o update do tipo_compra
    const [upd] = await sql`
      UPDATE ingredientes SET
        nome=${nome}, id_categoria=${id_categoria ?? null}, unidade=${unidade},
        estoque_minimo=${estoque_minimo}, estoque_critico=${estoque_critico},
        qtd_compra_normal=${qtd_compra_normal}, tipo_compra=${tipo_compra ?? 'mercado'}
      WHERE id_ingrediente=${req.params.id} AND status='1'
      RETURNING *
    `;
    if (!upd) return res.status(404).json({ mensagem: "Não encontrado" });
    return res.status(200).json(upd);
  } catch (e) {
    console.error(e);
    return res.status(500).json({ mensagem: "Erro inesperado" });
  }
});

routes.delete("/ingredientes/:id", async (req, res) => {
  try {
    const [d] =
      await sql`UPDATE ingredientes SET status='0' WHERE id_ingrediente=${req.params.id} AND status='1' RETURNING id_ingrediente`;
    if (!d) return res.status(404).json({ mensagem: "Não encontrado" });
    return res.status(204).send();
  } catch (e) {
    console.error(e);
    return res.status(500).json({ mensagem: "Erro inesperado" });
  }
});

// ─── Adicionar / Retirar quantidade ──────────────────────────────────────────

routes.post("/ingredientes/:id/adicionar", async (req, res) => {
  try {
    const { quantidade, operador, observacao } = req.body;
    if (!quantidade || Number(quantidade) <= 0)
      return res.status(400).json({ mensagem: "Quantidade inválida" });
    const [upd] = await sql`
      UPDATE ingredientes SET quantidade_atual = quantidade_atual + ${Number(quantidade)}
      WHERE id_ingrediente = ${req.params.id} AND status = '1'
      RETURNING *
    `;
    if (!upd)
      return res.status(404).json({ mensagem: "Ingrediente não encontrado" });
    await sql`
      INSERT INTO movimentos_ingredientes (ingrediente_id, tipo, quantidade, operador, observacao)
      VALUES (${req.params.id}, 'ENTRADA', ${Number(quantidade)}, ${operador}, ${observacao ?? null})
    `;
    return res.status(200).json(upd);
  } catch (e) {
    console.error(e);
    return res.status(500).json({ mensagem: "Erro inesperado" });
  }
});

routes.post("/ingredientes/:id/retirar", async (req, res) => {
  try {
    const { quantidade, operador, observacao } = req.body;
    if (!quantidade || Number(quantidade) <= 0)
      return res.status(400).json({ mensagem: "Quantidade inválida" });
    const [atual] =
      await sql`SELECT quantidade_atual FROM ingredientes WHERE id_ingrediente = ${req.params.id} AND status='1'`;
    if (!atual)
      return res.status(404).json({ mensagem: "Ingrediente não encontrado" });
    if (Number(atual.quantidade_atual) < Number(quantidade))
      return res.status(400).json({ mensagem: "Stock insuficiente" });
    const [upd] = await sql`
      UPDATE ingredientes SET quantidade_atual = quantidade_atual - ${Number(quantidade)}
      WHERE id_ingrediente = ${req.params.id} AND status = '1'
      RETURNING *
    `;
    await sql`
      INSERT INTO movimentos_ingredientes (ingrediente_id, tipo, quantidade, operador, observacao)
      VALUES (${req.params.id}, 'SAIDA', ${Number(quantidade)}, ${operador}, ${observacao ?? null})
    `;
    return res.status(200).json(upd);
  } catch (e) {
    console.error(e);
    return res.status(500).json({ mensagem: "Erro inesperado" });
  }
});

routes.get("/movimentos-ingredientes", async (req, res) => {
  try {
    const limite = Number(req.query.limite) || 200;
    const operador = typeof req.query.operador === "string" ? req.query.operador : undefined;
    const mes = typeof req.query.mes === "string" ? req.query.mes : undefined; // formato: "2026-06"

    const r = operador
      ? await sql`
          SELECT m.*, i.nome AS ingrediente_nome, i.unidade,
                 c.nome AS categoria_nome
          FROM movimentos_ingredientes m
          JOIN ingredientes i ON i.id_ingrediente = m.ingrediente_id
          LEFT JOIN categorias c ON c.id_categoria = i.id_categoria
          WHERE m.operador = ${operador}
          ORDER BY m.id_movimento DESC
          LIMIT ${limite}
        `
      : mes
      ? await sql`
          SELECT m.*, i.nome AS ingrediente_nome, i.unidade,
                 c.nome AS categoria_nome
          FROM movimentos_ingredientes m
          JOIN ingredientes i ON i.id_ingrediente = m.ingrediente_id
          LEFT JOIN categorias c ON c.id_categoria = i.id_categoria
          WHERE to_char(m.data_movimento::timestamp, 'YYYY-MM') = ${mes}
          ORDER BY m.id_movimento DESC
          LIMIT ${limite}
        `
      : await sql`
          SELECT m.*, i.nome AS ingrediente_nome, i.unidade,
                 c.nome AS categoria_nome
          FROM movimentos_ingredientes m
          JOIN ingredientes i ON i.id_ingrediente = m.ingrediente_id
          LEFT JOIN categorias c ON c.id_categoria = i.id_categoria
          ORDER BY m.id_movimento DESC
          LIMIT ${limite}
        `;
    return res.status(200).json(r);
  } catch (e) {
    console.error(e);
    return res.status(500).json({ mensagem: "Erro inesperado" });
  }
});

export default routes;
