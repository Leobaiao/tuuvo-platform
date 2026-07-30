import { Router } from "express";
import { pool } from "../db/pool";
import { getDriver } from "../drivers/registry";
import { ingestInboundMessage } from "../services/conversation.service";

export const webhooksRouter = Router();

/** WhatsApp/GTI — uma URL por conexão. */
webhooksRouter.post("/gti/:connectionId", async (req, res) => {
  const { connectionId } = req.params;
  const conn = await pool.query(`SELECT tenant_id FROM channel_connections WHERE id = $1`, [connectionId]);
  if (!conn.rows[0]) return res.status(404).end();

  const driver = getDriver("whatsapp_gti");
  const messages = driver.normalizeInbound(req.body);
  for (const msg of messages) await ingestInboundMessage(conn.rows[0].tenant_id, connectionId, msg);
  res.status(200).json({ ok: true });
});

/**
 * Zernio — URL única a nível de plataforma, roteada por `account.id`
 * (aninhado, confirmado em docs.zernio.com/multi-tenant/inbox).
 * TODO produção: verificar assinatura HMAC-SHA256 (X-Zernio-Signature) e
 * dedupe por `event.id` — entrega é "at-least-once" (mesma nota da v1).
 */
webhooksRouter.post("/zernio", async (req, res) => {
  const body = req.body as { account?: { id?: string } };
  const accountId = body.account?.id;
  if (!accountId) return res.status(400).json({ error: "account.id ausente no callback" });

  const conn = await pool.query(
    `SELECT id, tenant_id, driver FROM channel_connections WHERE (config->>'accountId') = $1 LIMIT 1`,
    [accountId]
  );
  if (!conn.rows[0]) {
    console.warn(`Callback Zernio sem conexão mapeada para account.id=${accountId}`);
    return res.status(200).json({ ok: true });
  }

  const driver = getDriver(conn.rows[0].driver);
  const messages = driver.normalizeInbound(req.body);
  for (const msg of messages) await ingestInboundMessage(conn.rows[0].tenant_id, conn.rows[0].id, msg);
  res.status(200).json({ ok: true });
});

/** RCS/MKOM — URL única a nível de plataforma, roteada por cost_centre_id. */
webhooksRouter.post("/mkom", async (req, res) => {
  const body = req.body as { mailing?: { cost_centre?: { id?: number } } };
  const costCentreId = body.mailing?.cost_centre?.id;
  if (!costCentreId) return res.status(400).json({ error: "cost_centre_id ausente no callback" });

  const conn = await pool.query(
    `SELECT id, tenant_id, driver FROM channel_connections WHERE (config->>'cost_centre_id')::int = $1 LIMIT 1`,
    [costCentreId]
  );
  if (!conn.rows[0]) {
    console.warn(`Callback MKOM sem conexão mapeada para cost_centre_id=${costCentreId}`);
    return res.status(200).json({ ok: true });
  }

  const driver = getDriver(conn.rows[0].driver);
  const messages = driver.normalizeInbound(req.body);
  for (const msg of messages) await ingestInboundMessage(conn.rows[0].tenant_id, conn.rows[0].id, msg);
  res.status(200).json({ ok: true });
});

/**
 * E-mail — provedor de inbound parse (ex.: SendGrid Inbound Parse, Mailgun
 * Routes) chama isso quando chega e-mail novo. Roteamento pelo endereço de
 * destino (config.enderecoRemetente da conexão) — TODO produção: confirmar
 * exatamente qual provedor será usado e ajustar o formato do payload aqui.
 */
webhooksRouter.post("/email", async (req, res) => {
  const body = req.body as { to?: string };
  if (!body.to) return res.status(400).json({ error: "destinatário ausente no callback" });

  const conn = await pool.query(
    `SELECT id, tenant_id FROM channel_connections
     WHERE tipo = 'email' AND (config->>'enderecoRemetente') = $1 LIMIT 1`,
    [body.to]
  );
  if (!conn.rows[0]) {
    console.warn(`Callback de e-mail sem conexão mapeada para destinatário=${body.to}`);
    return res.status(200).json({ ok: true });
  }

  const driver = getDriver("email");
  const messages = driver.normalizeInbound(req.body);
  for (const msg of messages) await ingestInboundMessage(conn.rows[0].tenant_id, conn.rows[0].id, msg);
  res.status(200).json({ ok: true });
});
