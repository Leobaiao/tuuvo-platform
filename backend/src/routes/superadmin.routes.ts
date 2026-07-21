import { Router } from "express";
import { z } from "zod";
import { pool, withTenantContext } from "../db/pool";
import { requireAuth, requireSuperadmin } from "../middleware/auth";
import { hashPassword } from "../services/auth.service";
import { encryptCredential } from "../utils/crypto";

export const superadminRouter = Router();
superadminRouter.use(requireAuth, requireSuperadmin);

// ---------------------------------------------------------------------------
// Tenants
// ---------------------------------------------------------------------------

const createTenantSchema = z.object({
  nome: z.string().min(2),
  slug: z.string().min(2).regex(/^[a-z0-9-]+$/),
  adminEmail: z.string().email(),
  adminSenha: z.string().min(8),
  plano: z.string().default("trial"),
});

superadminRouter.post("/tenants", async (req, res) => {
  const parsed = createTenantSchema.safeParse(req.body);
  if (!parsed.success) return res.status(400).json({ error: parsed.error.flatten() });
  const { nome, slug, adminEmail, adminSenha, plano } = parsed.data;

  const result = await withTenantContext(null, true, async (client) => {
    const tenant = await client.query(
      `INSERT INTO tenants (nome, slug, plano, trial_expira_em)
       VALUES ($1, $2, $3, now() + interval '15 days')
       RETURNING id, nome, slug, plano, status, criado_em`,
      [nome, slug, plano]
    );
    const tenantId = tenant.rows[0].id;

    const senhaHash = await hashPassword(adminSenha);
    await client.query(
      `INSERT INTO users (tenant_id, email, senha_hash, nome, papel)
       VALUES ($1, $2, $3, 'Administrador', 'admin')`,
      [tenantId, adminEmail, senhaHash]
    );

    // Departamento padrão, conforme onboarding (seção 10 da especificação)
    await client.query(
      `INSERT INTO departments (tenant_id, nome) VALUES ($1, 'Atendimento Geral')`,
      [tenantId]
    );

    return tenant.rows[0];
  });

  res.status(201).json(result);
});

superadminRouter.get("/tenants", async (_req, res) => {
  const result = await withTenantContext(null, true, (client) =>
    client.query(
      `SELECT id, nome, slug, plano, status, limites, trial_expira_em, criado_em
       FROM tenants ORDER BY criado_em DESC`
    )
  );
  res.json(result.rows);
});

superadminRouter.patch("/tenants/:id/status", async (req, res) => {
  const schema = z.object({ status: z.enum(["ativo", "suspenso", "cancelado"]) });
  const parsed = schema.safeParse(req.body);
  if (!parsed.success) return res.status(400).json({ error: parsed.error.flatten() });

  await withTenantContext(null, true, (client) =>
    client.query(`UPDATE tenants SET status = $1 WHERE id = $2`, [
      parsed.data.status,
      req.params.id,
    ])
  );
  res.status(204).send();
});

// ---------------------------------------------------------------------------
// Credenciais de brokers a nível de plataforma (SMS/RCS via MKOM, Voz futuro)
// Ver seção 5 e 6.4/6.5 da especificação: essas credenciais NÃO são por tenant.
// ---------------------------------------------------------------------------

const createProviderSchema = z.object({
  tipo: z.enum(["sms", "rcs", "voz", "zernio"]),
  nome: z.string().min(2),
  endpointBase: z.string().url(),
  token: z.string().min(10),
  config: z.record(z.unknown()).default({}),
});

superadminRouter.post("/channel-providers", async (req, res) => {
  const parsed = createProviderSchema.safeParse(req.body);
  if (!parsed.success) return res.status(400).json({ error: parsed.error.flatten() });
  const { tipo, nome, endpointBase, token, config } = parsed.data;

  const encrypted = encryptCredential(token);
  const result = await pool.query(
    `INSERT INTO platform_channel_providers (tipo, nome, endpoint_base, credenciais_enc, config)
     VALUES ($1, $2, $3, $4, $5)
     RETURNING id, tipo, nome, endpoint_base, config, ativo, criado_em`,
    [tipo, nome, endpointBase, encrypted, config]
  );
  res.status(201).json(result.rows[0]);
});

superadminRouter.get("/channel-providers", async (_req, res) => {
  // Nunca devolve credenciais_enc — só metadados, pra tela do Superadmin listar
  // "quantas instâncias existem e o status delas" sem expor segredo nenhum.
  const result = await pool.query(
    `SELECT id, tipo, nome, endpoint_base, config, ativo, criado_em
     FROM platform_channel_providers ORDER BY criado_em DESC`
  );
  res.json(result.rows);
});
