import { Router, Request, Response, NextFunction } from "express";
import { z } from "zod";
import { pool, withTenantContext } from "../db/pool";
import { requireTenantAuth, requireTenantPapel } from "../middleware/auth";
import { encryptCredential, decryptCredential } from "../utils/crypto";
import { getDriver } from "../drivers/registry";
import { registerGtiConnection } from "../drivers/WhatsAppGtiDriver";
import { registerZernioConnection, ZernioPlatform } from "../drivers/ZernioDriver";
import { registerMkomConnection } from "../drivers/MkomRcsDriver";
import { registerEmailConnection } from "../drivers/EmailDriver";
import { hashPassword } from "../services/authTenant.service";

export const tenantRouter = Router();
tenantRouter.use(requireTenantAuth);

function requireTenant(req: Request, res: Response, next: NextFunction) {
  if (!req.tenantAuth?.tenantId) return res.status(403).json({ error: "Rota exclusiva de tenant" });
  next();
}
tenantRouter.use(requireTenant);

// ---------------------------------------------------------------------------
// Equipes (renomeado de "departamentos" — arquitetura v2, seção 9)
// ---------------------------------------------------------------------------

const equipeSchema = z.object({
  nome: z.string().min(2),
  horarioAtendimento: z.record(z.unknown()).optional(),
  regrasRoteamento: z.record(z.unknown()).optional(),
});

tenantRouter.get("/equipes", async (req, res) => {
  const rows = await withTenantContext(req.tenantAuth!.tenantId, false, (client) =>
    client.query(`SELECT * FROM equipes ORDER BY criado_em`)
  );
  res.json(rows.rows);
});

tenantRouter.post("/equipes", requireTenantPapel("admin", "supervisor"), async (req, res) => {
  const parsed = equipeSchema.safeParse(req.body);
  if (!parsed.success) return res.status(400).json({ error: parsed.error.flatten() });
  const row = await withTenantContext(req.tenantAuth!.tenantId, false, (client) =>
    client.query(
      `INSERT INTO equipes (tenant_id, nome, horario_atendimento, regras_roteamento) VALUES ($1,$2,$3,$4) RETURNING *`,
      [req.tenantAuth!.tenantId, parsed.data.nome, parsed.data.horarioAtendimento ?? {}, parsed.data.regrasRoteamento ?? {}]
    )
  );
  res.status(201).json(row.rows[0]);
});

// ---------------------------------------------------------------------------
// Canais — cada tipo com fluxo próprio de conexão
// ---------------------------------------------------------------------------

tenantRouter.get("/channels", async (req, res) => {
  const rows = await withTenantContext(req.tenantAuth!.tenantId, false, (client) =>
    client.query(`SELECT id, tipo, driver, nome, status, ativo, criado_em FROM channel_connections ORDER BY criado_em DESC`)
  );
  res.json(rows.rows);
});

tenantRouter.get("/channels/:id/status", async (req, res) => {
  const conn = await withTenantContext(req.tenantAuth!.tenantId, false, (client) =>
    client.query(`SELECT driver, status FROM channel_connections WHERE id = $1`, [req.params.id])
  );
  if (!conn.rows[0]) return res.status(404).json({ error: "Conexão não encontrada" });
  if (conn.rows[0].driver === "webchat_native") return res.json({ status: conn.rows[0].status });
  const driver = getDriver(conn.rows[0].driver);
  const status = await driver.getStatus(req.params.id);
  res.json({ status });
});

async function vincularEquipes(client: any, connectionId: string, equipeIds: string[]) {
  for (const equipeId of equipeIds) {
    await client.query(
      `INSERT INTO equipe_channels (equipe_id, channel_connection_id) VALUES ($1,$2)`,
      [equipeId, connectionId]
    );
  }
}

// --- Webchat: nasce conectado, sem provedor externo ---
const connectWebchatSchema = z.object({ nome: z.string().min(2), equipeIds: z.array(z.string().uuid()).min(1) });
tenantRouter.post("/channels/webchat", requireTenantPapel("admin"), async (req, res) => {
  const parsed = connectWebchatSchema.safeParse(req.body);
  if (!parsed.success) return res.status(400).json({ error: parsed.error.flatten() });
  const result = await withTenantContext(req.tenantAuth!.tenantId, false, async (client) => {
    const conn = await client.query(
      `INSERT INTO channel_connections (tenant_id, tipo, driver, nome, status)
       VALUES ($1, 'webchat', 'webchat_native', $2, 'conectado') RETURNING *`,
      [req.tenantAuth!.tenantId, parsed.data.nome]
    );
    await vincularEquipes(client, conn.rows[0].id, parsed.data.equipeIds);
    return conn.rows[0];
  });
  res.status(201).json(result);
});

// --- WhatsApp não-oficial (GTI) ---
const connectWhatsappGtiSchema = z.object({
  nome: z.string().min(2), token: z.string().min(10), phone: z.string().optional(),
  equipeIds: z.array(z.string().uuid()).min(1),
});
tenantRouter.post("/channels/whatsapp-gti", requireTenantPapel("admin"), async (req, res) => {
  const parsed = connectWhatsappGtiSchema.safeParse(req.body);
  if (!parsed.success) return res.status(400).json({ error: parsed.error.flatten() });
  const { nome, token, phone, equipeIds } = parsed.data;
  const encrypted = encryptCredential(token);

  const result = await withTenantContext(req.tenantAuth!.tenantId, false, async (client) => {
    const conn = await client.query(
      `INSERT INTO channel_connections (tenant_id, tipo, driver, nome, credenciais_enc, status)
       VALUES ($1, 'whatsapp_gti', 'whatsapp_gti', $2, $3, 'desconectado') RETURNING *`,
      [req.tenantAuth!.tenantId, nome, encrypted]
    );
    await vincularEquipes(client, conn.rows[0].id, equipeIds);
    return conn.rows[0];
  });

  const driver = getDriver("whatsapp_gti");
  const connectResult = await driver.connect(result.id, { token, phone });
  await withTenantContext(req.tenantAuth!.tenantId, false, (client) =>
    client.query(`UPDATE channel_connections SET status = $1 WHERE id = $2`, [connectResult.status, result.id])
  );
  res.status(201).json({ ...result, ...connectResult });
});

// --- Zernio: WhatsApp oficial OU rede social — mesmo endpoint, diferenciado
// por `platform` (arquitetura v2, seção 3.3: "plugar canal novo é cadastro, não código") ---
const connectZernioSchema = z.object({
  nome: z.string().min(2),
  platform: z.enum(["whatsapp", "instagram", "telegram", "facebook", "x", "bluesky", "reddit"]),
  profileId: z.string().min(3),
  accountId: z.string().min(3),
  equipeIds: z.array(z.string().uuid()).min(1),
});
tenantRouter.post("/channels/zernio", requireTenantPapel("admin"), async (req, res) => {
  const parsed = connectZernioSchema.safeParse(req.body);
  if (!parsed.success) return res.status(400).json({ error: parsed.error.flatten() });
  const { nome, platform, profileId, accountId, equipeIds } = parsed.data;

  const provider = await pool.query(
    `SELECT id, credenciais_enc FROM platform_channel_providers WHERE tipo = 'zernio' AND ativo = true LIMIT 1`
  );
  if (!provider.rows[0]) return res.status(400).json({ error: "Nenhum provider Zernio cadastrado na Administração TUUVO" });

  const tipoCanal = platform === "whatsapp" ? "whatsapp_zernio" : `zernio_${platform}`;
  const result = await withTenantContext(req.tenantAuth!.tenantId, false, async (client) => {
    const conn = await client.query(
      `INSERT INTO channel_connections (tenant_id, tipo, driver, nome, platform_provider_id, config, status)
       VALUES ($1, $2, 'zernio', $3, $4, $5, 'conectado') RETURNING *`,
      [req.tenantAuth!.tenantId, tipoCanal, nome, provider.rows[0].id, { profileId, accountId, platform }]
    );
    await vincularEquipes(client, conn.rows[0].id, equipeIds);
    return conn.rows[0];
  });

  const token = decryptCredential(provider.rows[0].credenciais_enc);
  registerZernioConnection(result.id, token, { profileId, accountId, platform: platform as ZernioPlatform });
  res.status(201).json(result);
});

// --- RCS (MKOM) ---
const connectRcsSchema = z.object({
  nome: z.string().min(2), costCentreId: z.number().int(), equipeIds: z.array(z.string().uuid()).min(1),
});
tenantRouter.post("/channels/rcs", requireTenantPapel("admin"), async (req, res) => {
  const parsed = connectRcsSchema.safeParse(req.body);
  if (!parsed.success) return res.status(400).json({ error: parsed.error.flatten() });
  const { nome, costCentreId, equipeIds } = parsed.data;

  const provider = await pool.query(
    `SELECT id, credenciais_enc FROM platform_channel_providers WHERE tipo = 'rcs' AND ativo = true LIMIT 1`
  );
  if (!provider.rows[0]) return res.status(400).json({ error: "Nenhum provider de RCS cadastrado na Administração TUUVO" });

  const result = await withTenantContext(req.tenantAuth!.tenantId, false, async (client) => {
    const conn = await client.query(
      `INSERT INTO channel_connections (tenant_id, tipo, driver, nome, platform_provider_id, config, status)
       VALUES ($1, 'rcs', 'mkom_rcs', $2, $3, $4, 'conectado') RETURNING *`,
      [req.tenantAuth!.tenantId, nome, provider.rows[0].id, { cost_centre_id: costCentreId }]
    );
    await vincularEquipes(client, conn.rows[0].id, equipeIds);
    return conn.rows[0];
  });

  const token = decryptCredential(provider.rows[0].credenciais_enc);
  registerMkomConnection(result.id, { token, costCentreId });
  res.status(201).json(result);
});

// --- E-mail (novo — seção 3.7, delimitador tratado inteiramente no driver) ---
const connectEmailSchema = z.object({
  nome: z.string().min(2), imapHost: z.string().min(3), smtpHost: z.string().min(3),
  enderecoRemetente: z.string().email(), equipeIds: z.array(z.string().uuid()).min(1),
});
tenantRouter.post("/channels/email", requireTenantPapel("admin"), async (req, res) => {
  const parsed = connectEmailSchema.safeParse(req.body);
  if (!parsed.success) return res.status(400).json({ error: parsed.error.flatten() });
  const { nome, imapHost, smtpHost, enderecoRemetente, equipeIds } = parsed.data;

  const result = await withTenantContext(req.tenantAuth!.tenantId, false, async (client) => {
    const conn = await client.query(
      `INSERT INTO channel_connections (tenant_id, tipo, driver, nome, config, status)
       VALUES ($1, 'email', 'email', $2, $3, 'conectado') RETURNING *`,
      [req.tenantAuth!.tenantId, nome, { imapHost, smtpHost, enderecoRemetente }]
    );
    await vincularEquipes(client, conn.rows[0].id, equipeIds);
    return conn.rows[0];
  });

  registerEmailConnection(result.id, { imapHost, smtpHost, enderecoRemetente });
  res.status(201).json(result);
});

// ---------------------------------------------------------------------------
// Widget Builder — config_json cobre as ~35 chaves da seção 10.1
// ---------------------------------------------------------------------------

const widgetSchema = z.object({ nome: z.string().min(2), configJson: z.record(z.unknown()) });

tenantRouter.get("/widgets", async (req, res) => {
  const rows = await withTenantContext(req.tenantAuth!.tenantId, false, (client) =>
    client.query(`SELECT * FROM bot_widgets ORDER BY criado_em DESC`)
  );
  res.json(rows.rows);
});

tenantRouter.get("/widgets/:id", async (req, res) => {
  const row = await withTenantContext(req.tenantAuth!.tenantId, false, (client) =>
    client.query(`SELECT * FROM bot_widgets WHERE id = $1`, [req.params.id])
  );
  if (!row.rows[0]) return res.status(404).json({ error: "Widget não encontrado" });
  res.json(row.rows[0]);
});

tenantRouter.post("/widgets", requireTenantPapel("admin"), async (req, res) => {
  const parsed = widgetSchema.safeParse(req.body);
  if (!parsed.success) return res.status(400).json({ error: parsed.error.flatten() });
  const row = await withTenantContext(req.tenantAuth!.tenantId, false, (client) =>
    client.query(
      `INSERT INTO bot_widgets (tenant_id, nome, config_json) VALUES ($1,$2,$3) RETURNING *`,
      [req.tenantAuth!.tenantId, parsed.data.nome, parsed.data.configJson]
    )
  );
  res.status(201).json(row.rows[0]);
});

tenantRouter.put("/widgets/:id", requireTenantPapel("admin"), async (req, res) => {
  const parsed = widgetSchema.partial().safeParse(req.body);
  if (!parsed.success) return res.status(400).json({ error: parsed.error.flatten() });
  const row = await withTenantContext(req.tenantAuth!.tenantId, false, (client) =>
    client.query(
      `UPDATE bot_widgets SET nome = COALESCE($1,nome), config_json = COALESCE($2,config_json), versao = versao + 1
       WHERE id = $3 RETURNING *`,
      [parsed.data.nome, parsed.data.configJson, req.params.id]
    )
  );
  if (!row.rows[0]) return res.status(404).json({ error: "Widget não encontrado" });
  res.json(row.rows[0]);
});

tenantRouter.post("/widgets/:id/publish", requireTenantPapel("admin"), async (req, res) => {
  const row = await withTenantContext(req.tenantAuth!.tenantId, false, (client) =>
    client.query(`UPDATE bot_widgets SET publicado = true WHERE id = $1 RETURNING *`, [req.params.id])
  );
  if (!row.rows[0]) return res.status(404).json({ error: "Widget não encontrado" });
  res.json(row.rows[0]);
});

// ---------------------------------------------------------------------------
// Equipe de atendentes (usuários do tenant, com equipe/permissão — seção 6)
// ---------------------------------------------------------------------------

tenantRouter.get("/usuarios", async (req, res) => {
  const rows = await withTenantContext(req.tenantAuth!.tenantId, false, (client) =>
    client.query(`SELECT id, nome, email, papel, equipe_id, permissoes, status, criado_em FROM users ORDER BY criado_em`)
  );
  res.json(rows.rows);
});

const inviteUserSchema = z.object({
  nome: z.string().min(2), email: z.string().email(), senhaProvisoria: z.string().min(8),
  papel: z.enum(["admin", "supervisor", "agente"]).default("agente"),
  equipeId: z.string().uuid().nullable().default(null),
  permissoes: z.record(z.unknown()).default({}),
});

tenantRouter.post("/usuarios", requireTenantPapel("admin"), async (req, res) => {
  const parsed = inviteUserSchema.safeParse(req.body);
  if (!parsed.success) return res.status(400).json({ error: parsed.error.flatten() });
  const d = parsed.data;
  const senhaHash = await hashPassword(d.senhaProvisoria);
  const row = await withTenantContext(req.tenantAuth!.tenantId, false, (client) =>
    client.query(
      `INSERT INTO users (tenant_id, email, senha_hash, nome, papel, equipe_id, permissoes)
       VALUES ($1,$2,$3,$4,$5,$6,$7) RETURNING id, nome, email, papel, equipe_id, permissoes, status, criado_em`,
      [req.tenantAuth!.tenantId, d.email, senhaHash, d.nome, d.papel, d.equipeId, d.permissoes]
    )
  );
  res.status(201).json(row.rows[0]);
});

// ---------------------------------------------------------------------------
// Relatórios / mini-BI (arquitetura v2, seção 5) — filtros comuns: período,
// canal, equipe. Consulta direta em conversations/messages, sem tabela de
// agregação — ver seção 5, "otimização de depois, não desenho inicial".
// ---------------------------------------------------------------------------

tenantRouter.get("/relatorios/resumo", async (req, res) => {
  const tenantId = req.tenantAuth!.tenantId;
  const de = (req.query.de as string) ?? new Date(Date.now() - 30 * 86400000).toISOString();
  const ate = (req.query.ate as string) ?? new Date().toISOString();

  const rows = await withTenantContext(tenantId, false, (client) =>
    client.query(
      `SELECT
         COUNT(*) FILTER (WHERE status = 'aberta') AS abertas,
         COUNT(*) FILTER (WHERE status = 'em_atendimento') AS em_atendimento,
         COUNT(*) FILTER (WHERE status = 'fechada') AS fechadas,
         COUNT(*) AS total,
         AVG(EXTRACT(EPOCH FROM (fechada_em - aberta_em))) FILTER (WHERE fechada_em IS NOT NULL) AS tempo_medio_fechamento_segundos
       FROM conversations WHERE aberta_em BETWEEN $1 AND $2`,
      [de, ate]
    )
  );

  const porCanal = await withTenantContext(tenantId, false, (client) =>
    client.query(
      `SELECT cc.tipo AS canal, COUNT(*) AS total
       FROM conversations c JOIN channel_connections cc ON cc.id = c.channel_connection_id
       WHERE c.aberta_em BETWEEN $1 AND $2 GROUP BY cc.tipo ORDER BY total DESC`,
      [de, ate]
    )
  );

  const porEquipe = await withTenantContext(tenantId, false, (client) =>
    client.query(
      `SELECT e.nome AS equipe, COUNT(*) AS total
       FROM conversations c LEFT JOIN equipes e ON e.id = c.equipe_id
       WHERE c.aberta_em BETWEEN $1 AND $2 GROUP BY e.nome ORDER BY total DESC`,
      [de, ate]
    )
  );

  const porDia = await withTenantContext(tenantId, false, (client) =>
    client.query(
      `SELECT date_trunc('day', aberta_em)::date AS dia, COUNT(*) AS total
       FROM conversations WHERE aberta_em BETWEEN $1 AND $2 GROUP BY dia ORDER BY dia`,
      [de, ate]
    )
  );

  res.json({ resumo: rows.rows[0], porCanal: porCanal.rows, porEquipe: porEquipe.rows, porDia: porDia.rows });
});

// ---------------------------------------------------------------------------
// API Keys — pra aplicação EXTERNA do tenant usar canais (WhatsApp, RCS,
// e-mail) via /conversations sem depender de login humano (JWT expira em
// horas; a API key não expira até ser revogada). Ver middleware/auth.ts.
// A chave só é mostrada UMA VEZ, na criação — depois só o prefixo fica visível.
// ---------------------------------------------------------------------------

tenantRouter.get("/api-keys", requireTenantPapel("admin"), async (req, res) => {
  const rows = await withTenantContext(req.tenantAuth!.tenantId, false, (client) =>
    client.query(`SELECT id, nome, prefixo, ultima_utilizacao, ativo, criado_em FROM api_keys ORDER BY criado_em DESC`)
  );
  res.json(rows.rows);
});

const criarApiKeySchema = z.object({ nome: z.string().min(2) });

tenantRouter.post("/api-keys", requireTenantPapel("admin"), async (req, res) => {
  const parsed = criarApiKeySchema.safeParse(req.body);
  if (!parsed.success) return res.status(400).json({ error: parsed.error.flatten() });

  // Chave crua = prefixo(8) + resto aleatório — só existe em texto puro aqui,
  // nunca mais depois (nem no banco, que guarda só o hash).
  const crypto = await import("crypto");
  const bcrypt = await import("bcryptjs");
  const chaveCrua = "tuuvo_" + crypto.randomBytes(24).toString("hex");
  const prefixo = chaveCrua.slice(0, 8);
  const chaveHash = await bcrypt.hash(chaveCrua, 10);

  const row = await withTenantContext(req.tenantAuth!.tenantId, false, (client) =>
    client.query(
      `INSERT INTO api_keys (tenant_id, nome, chave_hash, prefixo) VALUES ($1,$2,$3,$4)
       RETURNING id, nome, prefixo, ativo, criado_em`,
      [req.tenantAuth!.tenantId, parsed.data.nome, chaveHash, prefixo]
    )
  );
  // única vez que a chave crua aparece — o frontend precisa avisar o usuário disso.
  res.status(201).json({ ...row.rows[0], chave: chaveCrua });
});

tenantRouter.patch("/api-keys/:id/revogar", requireTenantPapel("admin"), async (req, res) => {
  await withTenantContext(req.tenantAuth!.tenantId, false, (client) =>
    client.query(`UPDATE api_keys SET ativo = false WHERE id = $1`, [req.params.id])
  );
  res.status(204).send();
});
