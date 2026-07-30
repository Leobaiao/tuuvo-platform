import { Router } from "express";
import { z } from "zod";
import { pool, withTenantContext } from "../db/pool";
import { requireTuuvoAuth, requireTuuvoSuperadmin } from "../middleware/auth";
import { hashPassword } from "../services/authTuuvo.service";
import { encryptCredential } from "../utils/crypto";
import { calcularConsumoMensal } from "../services/consumo.service";

export const tuuvoAdminRouter = Router();
tuuvoAdminRouter.use(requireTuuvoAuth);

// ---------------------------------------------------------------------------
// Tenants — cadastro manual OU vindo de onboarding (arquitetura v2, seção 7)
// ---------------------------------------------------------------------------

const createTenantSchema = z.object({
  nome: z.string().min(2),
  slug: z.string().min(2).regex(/^[a-z0-9-]+$/),
  adminEmail: z.string().email(),
  adminSenha: z.string().min(8),
  origem: z.enum(["onboarding", "manual"]).default("manual"),
  canaisEscolhidos: z.array(z.string()).default([]),
});

tuuvoAdminRouter.post("/tenants", async (req, res) => {
  const parsed = createTenantSchema.safeParse(req.body);
  if (!parsed.success) return res.status(400).json({ error: parsed.error.flatten() });
  const { nome, slug, adminEmail, adminSenha, origem, canaisEscolhidos } = parsed.data;

  const result = await withTenantContext(null, true, async (client) => {
    const tenant = await client.query(
      `INSERT INTO tenants (nome, slug, status, origem, canais_escolhidos_onboarding)
       VALUES ($1, $2, 'avaliacao', $3, $4)
       RETURNING id, nome, slug, status, origem, canais_escolhidos_onboarding, criado_em`,
      [nome, slug, origem, JSON.stringify(canaisEscolhidos)]
    );
    const tenantId = tenant.rows[0].id;

    const senhaHash = await hashPassword(adminSenha);
    await client.query(
      `INSERT INTO users (tenant_id, email, senha_hash, nome, papel)
       VALUES ($1, $2, $3, 'Administrador', 'admin')`,
      [tenantId, adminEmail, senhaHash]
    );

    // Equipe padrão + config padrão de webchat aplicada automaticamente
    // (seção 6, item 2 — "colocar a configuração padrão para webchat").
    const equipe = await client.query(
      `INSERT INTO equipes (tenant_id, nome) VALUES ($1, 'Atendimento Geral') RETURNING id`,
      [tenantId]
    );
    const webchatConn = await client.query(
      `INSERT INTO channel_connections (tenant_id, tipo, driver, nome, status)
       VALUES ($1, 'webchat', 'webchat_native', 'Webchat padrão', 'conectado') RETURNING id`,
      [tenantId]
    );
    await client.query(
      `INSERT INTO equipe_channels (equipe_id, channel_connection_id, padrao) VALUES ($1, $2, true)`,
      [equipe.rows[0].id, webchatConn.rows[0].id]
    );
    await client.query(
      `INSERT INTO bot_widgets (tenant_id, nome, config_json, publicado)
       VALUES ($1, 'Widget principal', '{}', true)`, // config_json vazio = usa os defaults do tuuvo-widget.js
      [tenantId]
    );

    return tenant.rows[0];
  });

  res.status(201).json(result);
});

tuuvoAdminRouter.get("/tenants", async (req, res) => {
  const status = req.query.status as string | undefined;
  const result = await withTenantContext(null, true, (client) =>
    client.query(
      `SELECT id, nome, slug, status, origem, avaliacao_adiada_ate, canais_escolhidos_onboarding, criado_em
       FROM tenants ${status ? "WHERE status = $1" : ""} ORDER BY criado_em DESC`,
      status ? [status] : []
    )
  );
  res.json(result.rows);
});

tuuvoAdminRouter.patch("/tenants/:id/status", async (req, res) => {
  const schema = z.object({ status: z.enum(["avaliacao", "ativo", "suspenso", "cancelado"]) });
  const parsed = schema.safeParse(req.body);
  if (!parsed.success) return res.status(400).json({ error: parsed.error.flatten() });
  await withTenantContext(null, true, (client) =>
    client.query(`UPDATE tenants SET status = $1 WHERE id = $2`, [parsed.data.status, req.params.id])
  );
  res.status(204).send();
});

/** Adiar avaliação do cliente (seção 6, item 4) — não decide agora, empurra a data. */
tuuvoAdminRouter.patch("/tenants/:id/adiar-avaliacao", async (req, res) => {
  const schema = z.object({ ate: z.string().datetime() });
  const parsed = schema.safeParse(req.body);
  if (!parsed.success) return res.status(400).json({ error: parsed.error.flatten() });
  await withTenantContext(null, true, (client) =>
    client.query(`UPDATE tenants SET avaliacao_adiada_ate = $1 WHERE id = $2`, [parsed.data.ate, req.params.id])
  );
  res.status(204).send();
});

// ---------------------------------------------------------------------------
// Planos de preço — CRUD + servido ao público via public.routes.ts (seção 8.1)
// ---------------------------------------------------------------------------

const planoSchema = z.object({
  nome: z.string().min(2),
  descricao: z.string().optional(),
  preco: z.number().nullable(),
  precoSufixo: z.string().default("/mês"),
  features: z.array(z.string()).default([]),
  destaque: z.boolean().default(false),
  ordemExibicao: z.number().default(0),
});

tuuvoAdminRouter.get("/planos", async (_req, res) => {
  const result = await pool.query(`SELECT * FROM planos ORDER BY ordem_exibicao`);
  res.json(result.rows);
});

tuuvoAdminRouter.post("/planos", requireTuuvoSuperadmin, async (req, res) => {
  const parsed = planoSchema.safeParse(req.body);
  if (!parsed.success) return res.status(400).json({ error: parsed.error.flatten() });
  const d = parsed.data;
  const result = await pool.query(
    `INSERT INTO planos (nome, descricao, preco, preco_sufixo, features, destaque, ordem_exibicao)
     VALUES ($1, $2, $3, $4, $5, $6, $7) RETURNING *`,
    [d.nome, d.descricao ?? null, d.preco, d.precoSufixo, JSON.stringify(d.features), d.destaque, d.ordemExibicao]
  );
  res.status(201).json(result.rows[0]);
});

tuuvoAdminRouter.put("/planos/:id", requireTuuvoSuperadmin, async (req, res) => {
  const parsed = planoSchema.partial().safeParse(req.body);
  if (!parsed.success) return res.status(400).json({ error: parsed.error.flatten() });
  const d = parsed.data;
  const result = await pool.query(
    `UPDATE planos SET
       nome = COALESCE($1, nome), descricao = COALESCE($2, descricao),
       preco = COALESCE($3, preco), preco_sufixo = COALESCE($4, preco_sufixo),
       features = COALESCE($5, features), destaque = COALESCE($6, destaque),
       ordem_exibicao = COALESCE($7, ordem_exibicao)
     WHERE id = $8 RETURNING *`,
    [d.nome, d.descricao, d.preco, d.precoSufixo,
     d.features ? JSON.stringify(d.features) : null, d.destaque, d.ordemExibicao, req.params.id]
  );
  if (!result.rows[0]) return res.status(404).json({ error: "Plano não encontrado" });
  res.json(result.rows[0]);
});

tuuvoAdminRouter.patch("/planos/:id/ativo", requireTuuvoSuperadmin, async (req, res) => {
  const schema = z.object({ ativo: z.boolean() });
  const parsed = schema.safeParse(req.body);
  if (!parsed.success) return res.status(400).json({ error: parsed.error.flatten() });
  await pool.query(`UPDATE planos SET ativo = $1 WHERE id = $2`, [parsed.data.ativo, req.params.id]);
  res.status(204).send();
});

// ---------------------------------------------------------------------------
// Credenciais de brokers a nível de plataforma (RCS/MKOM, Zernio)
// ---------------------------------------------------------------------------

const createProviderSchema = z.object({
  tipo: z.enum(["rcs", "zernio"]),
  nome: z.string().min(2),
  endpointBase: z.string().url(),
  token: z.string().min(10),
  config: z.record(z.unknown()).default({}),
});

tuuvoAdminRouter.post("/channel-providers", requireTuuvoSuperadmin, async (req, res) => {
  const parsed = createProviderSchema.safeParse(req.body);
  if (!parsed.success) return res.status(400).json({ error: parsed.error.flatten() });
  const { tipo, nome, endpointBase, token, config } = parsed.data;
  const encrypted = encryptCredential(token);
  const result = await pool.query(
    `INSERT INTO platform_channel_providers (tipo, nome, endpoint_base, credenciais_enc, config)
     VALUES ($1, $2, $3, $4, $5) RETURNING id, tipo, nome, endpoint_base, config, ativo, criado_em`,
    [tipo, nome, endpointBase, encrypted, config]
  );
  res.status(201).json(result.rows[0]);
});

tuuvoAdminRouter.get("/channel-providers", async (_req, res) => {
  // nunca devolve credenciais_enc
  const result = await pool.query(
    `SELECT id, tipo, nome, endpoint_base, config, ativo, criado_em FROM platform_channel_providers ORDER BY criado_em DESC`
  );
  res.json(result.rows);
});

// ---------------------------------------------------------------------------
// Usuários do time TUUVO (só superadmin cadastra outro)
// ---------------------------------------------------------------------------

tuuvoAdminRouter.get("/usuarios", async (_req, res) => {
  const result = await pool.query(`SELECT id, email, nome, papel, status, criado_em FROM tuuvo_users ORDER BY criado_em`);
  res.json(result.rows);
});

const inviteTuuvoUserSchema = z.object({
  nome: z.string().min(2), email: z.string().email(),
  senhaProvisoria: z.string().min(8), papel: z.enum(["superadmin", "operador"]).default("operador"),
});

tuuvoAdminRouter.post("/usuarios", requireTuuvoSuperadmin, async (req, res) => {
  const parsed = inviteTuuvoUserSchema.safeParse(req.body);
  if (!parsed.success) return res.status(400).json({ error: parsed.error.flatten() });
  const senhaHash = await hashPassword(parsed.data.senhaProvisoria);
  const result = await pool.query(
    `INSERT INTO tuuvo_users (email, senha_hash, nome, papel) VALUES ($1, $2, $3, $4)
     RETURNING id, email, nome, papel, status, criado_em`,
    [parsed.data.email, senhaHash, parsed.data.nome, parsed.data.papel]
  );
  res.status(201).json(result.rows[0]);
});

// ---------------------------------------------------------------------------
// Dashboard — métricas de negócio (seção 8.2) + faturamento manual
// ---------------------------------------------------------------------------

tuuvoAdminRouter.get("/dashboard", async (_req, res) => {
  const [tenantsAtivos, tenantsAvaliacao, faturamentoMes, faturamentoTrimestre, churnMes] =
    await Promise.all([
      pool.query(`SELECT COUNT(*) FROM tenants WHERE status = 'ativo'`),
      pool.query(`SELECT COUNT(*) FROM tenants WHERE status = 'avaliacao'`),
      pool.query(
        `SELECT COALESCE(SUM(valor_mensalidade + valor_consultoria + valor_consumo_rcs + valor_consumo_whatsapp_oficial),0) AS total
         FROM faturamento_mensal WHERE mes_referencia = date_trunc('month', now())::date`
      ),
      pool.query(
        `SELECT COALESCE(SUM(valor_mensalidade + valor_consultoria + valor_consumo_rcs + valor_consumo_whatsapp_oficial),0) AS total
         FROM faturamento_mensal WHERE mes_referencia >= date_trunc('quarter', now())::date`
      ),
      pool.query(
        `SELECT COUNT(*) FROM tenants WHERE status = 'cancelado'
           AND criado_em >= date_trunc('month', now())`
      ),
    ]);

  const grafico3meses = await pool.query(
    `SELECT mes_referencia,
            SUM(valor_mensalidade + valor_consultoria + valor_consumo_rcs + valor_consumo_whatsapp_oficial) AS receita
     FROM faturamento_mensal
     WHERE mes_referencia >= (date_trunc('month', now()) - interval '2 months')::date
     GROUP BY mes_referencia ORDER BY mes_referencia`
  );

  res.json({
    tenantsAtivos: Number(tenantsAtivos.rows[0].count),
    tenantsEmAvaliacao: Number(tenantsAvaliacao.rows[0].count),
    faturamentoMes: Number(faturamentoMes.rows[0].total),
    faturamentoTrimestre: Number(faturamentoTrimestre.rows[0].total),
    churnMes: Number(churnMes.rows[0].count),
    grafico3meses: grafico3meses.rows,
  });
});

const lancamentoFaturamentoSchema = z.object({
  tenantId: z.string().uuid(),
  mesReferencia: z.string(), // "2026-07-01"
  valorMensalidade: z.number().default(0),
  valorConsultoria: z.number().default(0),
  valorConsumoRcs: z.number().default(0),              // RECEITA — o que cobra do tenant
  valorConsumoWhatsappOficial: z.number().default(0),   // RECEITA — idem
  valorCustoRcs: z.number().default(0),                 // CUSTO — o que a MKOM cobra
  valorCustoWhatsappOficial: z.number().default(0),      // CUSTO — o que a Meta cobra
});

tuuvoAdminRouter.post("/faturamento", async (req, res) => {
  const parsed = lancamentoFaturamentoSchema.safeParse(req.body);
  if (!parsed.success) return res.status(400).json({ error: parsed.error.flatten() });
  const d = parsed.data;
  const result = await pool.query(
    `INSERT INTO faturamento_mensal
       (tenant_id, mes_referencia, valor_mensalidade, valor_consultoria,
        valor_consumo_rcs, valor_consumo_whatsapp_oficial,
        valor_custo_rcs, valor_custo_whatsapp_oficial, lancado_por)
     VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9)
     ON CONFLICT (tenant_id, mes_referencia) DO UPDATE SET
       valor_mensalidade = $3, valor_consultoria = $4,
       valor_consumo_rcs = $5, valor_consumo_whatsapp_oficial = $6,
       valor_custo_rcs = $7, valor_custo_whatsapp_oficial = $8
     RETURNING *`,
    [d.tenantId, d.mesReferencia, d.valorMensalidade, d.valorConsultoria,
     d.valorConsumoRcs, d.valorConsumoWhatsappOficial,
     d.valorCustoRcs, d.valorCustoWhatsappOficial, req.tuuvoAuth!.userId]
  );
  res.status(201).json(result.rows[0]);
});

/**
 * Calcula consumo automático de RCS/WhatsApp oficial pro mês, a partir das
 * mensagens de verdade (seção 14.3) — devolve CUSTO e RECEITA separados.
 * NÃO grava sozinho — devolve o cálculo pro superadmin conferir e decidir
 * lançar (via POST /faturamento acima).
 */
tuuvoAdminRouter.get("/faturamento/consumo-calculado", async (req, res) => {
  const schema = z.object({ tenantId: z.string().uuid(), mesReferencia: z.string() });
  const parsed = schema.safeParse(req.query);
  if (!parsed.success) return res.status(400).json({ error: parsed.error.flatten() });
  const resultado = await calcularConsumoMensal(parsed.data.tenantId, parsed.data.mesReferencia);
  res.json(resultado);
});

// ---------------------------------------------------------------------------
// Tarifas de canal — custo (fornecedor) e preço de venda (Admin TUUVO decide)
// ---------------------------------------------------------------------------

tuuvoAdminRouter.get("/tarifas", async (_req, res) => {
  const result = await pool.query(
    `SELECT DISTINCT ON (canal, categoria, pais) *
     FROM tarifas_canal ORDER BY canal, categoria, pais, vigente_desde DESC`
  );
  res.json(result.rows);
});

const editarPrecoSchema = z.object({ precoUnitario: z.number().min(0) });

/** Só o PREÇO DE VENDA é editável por aqui — custo vem do fornecedor, não se edita por capricho. */
tuuvoAdminRouter.patch("/tarifas/:id/preco", requireTuuvoSuperadmin, async (req, res) => {
  const parsed = editarPrecoSchema.safeParse(req.body);
  if (!parsed.success) return res.status(400).json({ error: parsed.error.flatten() });
  const result = await pool.query(
    `UPDATE tarifas_canal SET preco_unitario = $1 WHERE id = $2 RETURNING *`,
    [parsed.data.precoUnitario, req.params.id]
  );
  if (!result.rows[0]) return res.status(404).json({ error: "Tarifa não encontrada" });
  res.json(result.rows[0]);
});

// ---------------------------------------------------------------------------
// Relatório cross-tenant (seção 8.3) — mesma engine da seção 5, sem filtro
// de tenant_id fixo, só superadmin.
// ---------------------------------------------------------------------------

tuuvoAdminRouter.get("/relatorios/resumo", requireTuuvoSuperadmin, async (req, res) => {
  const de = (req.query.de as string) ?? new Date(Date.now() - 30 * 86400000).toISOString();
  const ate = (req.query.ate as string) ?? new Date().toISOString();

  const porCanal = await withTenantContext(null, true, (client) =>
    client.query(
      `SELECT cc.tipo AS canal, COUNT(*) AS total
       FROM conversations c JOIN channel_connections cc ON cc.id = c.channel_connection_id
       WHERE c.aberta_em BETWEEN $1 AND $2 GROUP BY cc.tipo ORDER BY total DESC`,
      [de, ate]
    )
  );

  const porTenant = await withTenantContext(null, true, (client) =>
    client.query(
      `SELECT t.nome AS tenant, COUNT(*) AS total
       FROM conversations c JOIN tenants t ON t.id = c.tenant_id
       WHERE c.aberta_em BETWEEN $1 AND $2 GROUP BY t.nome ORDER BY total DESC LIMIT 20`,
      [de, ate]
    )
  );

  res.json({ porCanal: porCanal.rows, porTenant: porTenant.rows });
});
