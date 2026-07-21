import { Router, Request, Response, NextFunction } from "express";
import { z } from "zod";
import { pool, withTenantContext } from "../db/pool";
import { requireAuth, requirePapel } from "../middleware/auth";
import { encryptCredential, decryptCredential } from "../utils/crypto";
import { getDriver } from "../drivers/registry";
import { registerMkomConnection } from "../drivers/SmsRcsMkomDriver";
import { registerZernioConnection } from "../drivers/ZernioDriver";
import { hashPassword } from "../services/auth.service";

export const tenantRouter = Router();
tenantRouter.use(requireAuth);

// Só usuários com tenant (não-superadmin) passam daqui — bate com o RLS do banco.
function requireTenant(req: Request, res: Response, next: NextFunction) {
  if (!req.auth?.tenantId) {
    return res.status(403).json({ error: "Rota exclusiva para usuários de um tenant" });
  }
  next();
}
tenantRouter.use(requireTenant);

// ---------------------------------------------------------------------------
// Departamentos (seção 7 da especificação)
// ---------------------------------------------------------------------------

const departmentSchema = z.object({
  nome: z.string().min(2),
  horarioAtendimento: z.record(z.unknown()).optional(),
  regrasRoteamento: z.record(z.unknown()).optional(),
});

tenantRouter.get("/departments", async (req, res) => {
  const rows = await withTenantContext(req.auth!.tenantId, false, (client) =>
    client.query(`SELECT * FROM departments ORDER BY criado_em`)
  );
  res.json(rows.rows);
});

tenantRouter.post(
  "/departments",
  requirePapel("admin", "supervisor"),
  async (req, res) => {
    const parsed = departmentSchema.safeParse(req.body);
    if (!parsed.success) return res.status(400).json({ error: parsed.error.flatten() });

    const row = await withTenantContext(req.auth!.tenantId, false, (client) =>
      client.query(
        `INSERT INTO departments (tenant_id, nome, horario_atendimento, regras_roteamento)
         VALUES ($1, $2, $3, $4) RETURNING *`,
        [
          req.auth!.tenantId,
          parsed.data.nome,
          parsed.data.horarioAtendimento ?? {},
          parsed.data.regrasRoteamento ?? {},
        ]
      )
    );
    res.status(201).json(row.rows[0]);
  }
);

// ---------------------------------------------------------------------------
// Conexões de canal — cada tipo tem um fluxo de criação um pouco diferente,
// mas todas terminam em channel_connections + associação a departamento(s).
// ---------------------------------------------------------------------------

const connectWhatsappSchema = z.object({
  nome: z.string().min(2),
  token: z.string().min(10), // token da instância GTI, já criado pelo tenant na GTI
  phone: z.string().optional(), // se informado, gera pair code em vez de QR
  departmentIds: z.array(z.string().uuid()).min(1),
});

tenantRouter.post(
  "/channels/whatsapp",
  requirePapel("admin"),
  async (req, res) => {
    const parsed = connectWhatsappSchema.safeParse(req.body);
    if (!parsed.success) return res.status(400).json({ error: parsed.error.flatten() });
    const { nome, token, phone, departmentIds } = parsed.data;

    const encrypted = encryptCredential(token);

    const result = await withTenantContext(req.auth!.tenantId, false, async (client) => {
      const conn = await client.query(
        `INSERT INTO channel_connections (tenant_id, tipo, driver, nome, credenciais_enc, status)
         VALUES ($1, 'whatsapp', 'whatsapp_gti', $2, $3, 'desconectado')
         RETURNING id, tipo, driver, nome, status, criado_em`,
        [req.auth!.tenantId, nome, encrypted]
      );
      const connectionId = conn.rows[0].id;

      for (const deptId of departmentIds) {
        await client.query(
          `INSERT INTO department_channels (department_id, channel_connection_id)
           VALUES ($1, $2)`,
          [deptId, connectionId]
        );
      }
      return conn.rows[0];
    });

    // Chama o driver de verdade para iniciar a conexão (QR code / pair code).
    // O driver.connect() já registra o token internamente (registerGtiConnection),
    // então passamos token + phone juntos aqui — nada de chamar registerGtiConnection
    // duas vezes com payloads diferentes, ou a segunda sobrescreve a primeira.
    const driver = getDriver("whatsapp_gti");
    const connectResult = await driver.connect(result.id, { token, phone });

    await withTenantContext(req.auth!.tenantId, false, (client) =>
      client.query(`UPDATE channel_connections SET status = $1 WHERE id = $2`, [
        connectResult.status,
        result.id,
      ])
    );

    res.status(201).json({ ...result, ...connectResult });
  }
);

// Webchat nativo não tem "provedor externo" — não passa por driver plugável,
// nasce conectado. É o próprio Socket.IO (realtime/socket.ts) quem entrega.
const connectWebchatSchema = z.object({
  nome: z.string().min(2),
  departmentIds: z.array(z.string().uuid()).min(1),
});

tenantRouter.post(
  "/channels/webchat",
  requirePapel("admin"),
  async (req, res) => {
    const parsed = connectWebchatSchema.safeParse(req.body);
    if (!parsed.success) return res.status(400).json({ error: parsed.error.flatten() });
    const { nome, departmentIds } = parsed.data;

    const result = await withTenantContext(req.auth!.tenantId, false, async (client) => {
      const conn = await client.query(
        `INSERT INTO channel_connections (tenant_id, tipo, driver, nome, status)
         VALUES ($1, 'webchat', 'webchat_native', $2, 'conectado')
         RETURNING id, tipo, driver, nome, status, criado_em`,
        [req.auth!.tenantId, nome]
      );
      const connectionId = conn.rows[0].id;

      for (const deptId of departmentIds) {
        await client.query(
          `INSERT INTO department_channels (department_id, channel_connection_id)
           VALUES ($1, $2)`,
          [deptId, connectionId]
        );
      }
      return conn.rows[0];
    });

    res.status(201).json(result);
  }
);

tenantRouter.get("/channels/:id/status", async (req, res) => {
  const conn = await withTenantContext(req.auth!.tenantId, false, (client) =>
    client.query(`SELECT driver, status FROM channel_connections WHERE id = $1`, [
      req.params.id,
    ])
  );
  if (!conn.rows[0]) return res.status(404).json({ error: "Conexão não encontrada" });

  if (conn.rows[0].driver === "webchat_native") {
    return res.json({ status: conn.rows[0].status });
  }

  const driver = getDriver(conn.rows[0].driver);
  const status = await driver.getStatus(req.params.id);
  res.json({ status });
});

// SMS e RCS não usam token por tenant — usam o broker de plataforma (MKOM,
// seção 5/6.4/6.5). O tenant só escolhe o tipo, o departamento e um
// cost_centre_id (usado pra MKOM cobrar/rastrear e pra roteamento do
// callback único de webhook — ver nota na seção 6.4).
const connectSmsRcsSchema = z.object({
  tipo: z.enum(["sms", "rcs"]),
  nome: z.string().min(2),
  costCentreId: z.number().int(),
  departmentIds: z.array(z.string().uuid()).min(1),
});

tenantRouter.post(
  "/channels/sms-rcs",
  requirePapel("admin"),
  async (req, res) => {
    const parsed = connectSmsRcsSchema.safeParse(req.body);
    if (!parsed.success) return res.status(400).json({ error: parsed.error.flatten() });
    const { tipo, nome, costCentreId, departmentIds } = parsed.data;

    const provider = await pool.query(
      `SELECT id, credenciais_enc FROM platform_channel_providers
       WHERE tipo = $1 AND ativo = true LIMIT 1`,
      [tipo]
    );
    if (!provider.rows[0]) {
      return res.status(400).json({
        error: `Nenhum provider de ${tipo.toUpperCase()} cadastrado no Superadmin`,
      });
    }

    const driverName = tipo === "sms" ? "mkom_sms" : "mkom_rcs";

    const result = await withTenantContext(req.auth!.tenantId, false, async (client) => {
      const conn = await client.query(
        `INSERT INTO channel_connections
           (tenant_id, tipo, driver, nome, platform_provider_id, config, status)
         VALUES ($1, $2, $3, $4, $5, $6, 'conectado')
         RETURNING id, tipo, driver, nome, status, criado_em`,
        [
          req.auth!.tenantId,
          tipo,
          driverName,
          nome,
          provider.rows[0].id,
          { cost_centre_id: costCentreId },
        ]
      );
      const connectionId = conn.rows[0].id;

      for (const deptId of departmentIds) {
        await client.query(
          `INSERT INTO department_channels (department_id, channel_connection_id)
           VALUES ($1, $2)`,
          [deptId, connectionId]
        );
      }
      return conn.rows[0];
    });

    const token = decryptCredential(provider.rows[0].credenciais_enc);
    registerMkomConnection(result.id, { token, costCentreId });

    res.status(201).json(result);
  }
);

// Redes sociais via Zernio — mesma lógica de credencial de plataforma que
// SMS/RCS (seção 6.3). Cada tenant vira 1 "profile" na Zernio (criado antes,
// ver createZernioProfileForTenant) e cada conta social conectada dentro
// desse profile é uma channel_connection.
const connectZernioSchema = z.object({
  plataforma: z.enum(["instagram", "telegram", "facebook", "x", "bluesky", "reddit"]),
  nome: z.string().min(2),
  profileId: z.string().min(3), // profile Zernio do tenant (1 por tenant, não por conexão)
  accountId: z.string().min(3), // conta social específica dentro do profile
  departmentIds: z.array(z.string().uuid()).min(1),
});

tenantRouter.post(
  "/channels/zernio",
  requirePapel("admin"),
  async (req, res) => {
    const parsed = connectZernioSchema.safeParse(req.body);
    if (!parsed.success) return res.status(400).json({ error: parsed.error.flatten() });
    const { plataforma, nome, profileId, accountId, departmentIds } = parsed.data;

    const provider = await pool.query(
      `SELECT id, credenciais_enc FROM platform_channel_providers
       WHERE tipo = 'zernio' AND ativo = true LIMIT 1`
    );
    if (!provider.rows[0]) {
      return res.status(400).json({
        error: "Nenhum provider Zernio cadastrado no Superadmin",
      });
    }

    const result = await withTenantContext(req.auth!.tenantId, false, async (client) => {
      const conn = await client.query(
        `INSERT INTO channel_connections
           (tenant_id, tipo, driver, nome, platform_provider_id, config, status)
         VALUES ($1, $2, 'zernio', $3, $4, $5, 'conectado')
         RETURNING id, tipo, driver, nome, status, criado_em`,
        [
          req.auth!.tenantId,
          `zernio_${plataforma}`,
          nome,
          provider.rows[0].id,
          { profileId, accountId, platform: plataforma },
        ]
      );
      const connectionId = conn.rows[0].id;

      for (const deptId of departmentIds) {
        await client.query(
          `INSERT INTO department_channels (department_id, channel_connection_id)
           VALUES ($1, $2)`,
          [deptId, connectionId]
        );
      }
      return conn.rows[0];
    });

    const token = decryptCredential(provider.rows[0].credenciais_enc);
    registerZernioConnection(result.id, token, { profileId, accountId, platform: plataforma });

    res.status(201).json(result);
  }
);

tenantRouter.get("/channels", async (req, res) => {
  const rows = await withTenantContext(req.auth!.tenantId, false, (client) =>
    client.query(
      `SELECT id, tipo, driver, nome, status, ativo, criado_em
       FROM channel_connections ORDER BY criado_em DESC`
    )
  );
  res.json(rows.rows);
});

// ---------------------------------------------------------------------------
// Widget Builder (seção 8 da especificação) — config_json guarda tudo:
// cores, header, avatar, dimensões, comportamento, integração.
// ---------------------------------------------------------------------------

const widgetSchema = z.object({
  nome: z.string().min(2),
  configJson: z.record(z.unknown()),
});

tenantRouter.post("/widgets", requirePapel("admin"), async (req, res) => {
  const parsed = widgetSchema.safeParse(req.body);
  if (!parsed.success) return res.status(400).json({ error: parsed.error.flatten() });

  const row = await withTenantContext(req.auth!.tenantId, false, (client) =>
    client.query(
      `INSERT INTO bot_widgets (tenant_id, nome, config_json)
       VALUES ($1, $2, $3) RETURNING *`,
      [req.auth!.tenantId, parsed.data.nome, parsed.data.configJson]
    )
  );
  res.status(201).json(row.rows[0]);
});

tenantRouter.put("/widgets/:id", requirePapel("admin"), async (req, res) => {
  const parsed = widgetSchema.partial().safeParse(req.body);
  if (!parsed.success) return res.status(400).json({ error: parsed.error.flatten() });

  const row = await withTenantContext(req.auth!.tenantId, false, (client) =>
    client.query(
      `UPDATE bot_widgets
       SET nome = COALESCE($1, nome),
           config_json = COALESCE($2, config_json),
           versao = versao + 1
       WHERE id = $3 RETURNING *`,
      [parsed.data.nome, parsed.data.configJson, req.params.id]
    )
  );
  if (!row.rows[0]) return res.status(404).json({ error: "Widget não encontrado" });
  res.json(row.rows[0]);
});

tenantRouter.post("/widgets/:id/publish", requirePapel("admin"), async (req, res) => {
  const row = await withTenantContext(req.auth!.tenantId, false, (client) =>
    client.query(
      `UPDATE bot_widgets SET publicado = true WHERE id = $1 RETURNING *`,
      [req.params.id]
    )
  );
  if (!row.rows[0]) return res.status(404).json({ error: "Widget não encontrado" });
  res.json(row.rows[0]);
});

tenantRouter.get("/widgets/:id", async (req, res) => {
  const row = await withTenantContext(req.auth!.tenantId, false, (client) =>
    client.query(`SELECT * FROM bot_widgets WHERE id = $1`, [req.params.id])
  );
  if (!row.rows[0]) return res.status(404).json({ error: "Widget não encontrado" });
  res.json(row.rows[0]);
});

tenantRouter.get("/widgets", async (req, res) => {
  const rows = await withTenantContext(req.auth!.tenantId, false, (client) =>
    client.query(`SELECT * FROM bot_widgets ORDER BY criado_em DESC`)
  );
  res.json(rows.rows);
});

// ---------------------------------------------------------------------------
// Equipe — múltiplos agentes atendendo em paralelo (seção "onboarding": convite
// da equipe). Só admin convida; qualquer papel autenticado pode listar (pra
// preencher o seletor de "atribuir a" no painel de conversas).
// ---------------------------------------------------------------------------

tenantRouter.get("/team", async (req, res) => {
  const rows = await withTenantContext(req.auth!.tenantId, false, (client) =>
    client.query(
      `SELECT id, nome, email, papel, status FROM users ORDER BY criado_em`
    )
  );
  res.json(rows.rows);
});

const inviteSchema = z.object({
  nome: z.string().min(2),
  email: z.string().email(),
  senhaProvisoria: z.string().min(8),
  papel: z.enum(["admin", "supervisor", "agente"]).default("agente"),
});

tenantRouter.post("/team", requirePapel("admin"), async (req, res) => {
  const parsed = inviteSchema.safeParse(req.body);
  if (!parsed.success) return res.status(400).json({ error: parsed.error.flatten() });

  const senhaHash = await hashPassword(parsed.data.senhaProvisoria);
  const row = await withTenantContext(req.auth!.tenantId, false, (client) =>
    client.query(
      `INSERT INTO users (tenant_id, email, senha_hash, nome, papel)
       VALUES ($1, $2, $3, $4, $5)
       RETURNING id, nome, email, papel, status, criado_em`,
      [req.auth!.tenantId, parsed.data.email, senhaHash, parsed.data.nome, parsed.data.papel]
    )
  );
  res.status(201).json(row.rows[0]);
});
