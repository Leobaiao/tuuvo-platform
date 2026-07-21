import { Router } from "express";
import { pool } from "../db/pool";
import { getDriver } from "../drivers/registry";
import { ingestInboundMessage } from "../services/conversation.service";

export const webhooksRouter = Router();

/**
 * WhatsApp/GTI — uma URL por conexão (a GTI registra webhook por instância,
 * então o :connectionId vem no path). Ver POST /webhook na seção 6.2.
 */
webhooksRouter.post("/gti/:connectionId", async (req, res) => {
  const { connectionId } = req.params;

  // Busca o tenant dono da conexão sem contexto de RLS ainda (é o próprio
  // ponto de entrada que descobre o tenant) — única query "crua" permitida
  // aqui por necessidade, exatamente como o login.
  const conn = await pool.query(
    `SELECT tenant_id FROM channel_connections WHERE id = $1`,
    [connectionId]
  );
  if (!conn.rows[0]) return res.status(404).end();

  const driver = getDriver("whatsapp_gti");
  const messages = driver.normalizeInbound(req.body);

  for (const msg of messages) {
    await ingestInboundMessage(conn.rows[0].tenant_id, connectionId, msg);
  }

  res.status(200).json({ ok: true });
});

/**
 * Zernio — igual à MKOM, uma URL de callback a nível de plataforma (até 10
 * endpoints por time, registrada via POST /webhooks/settings, ver
 * registerZernioWebhook em ZernioDriver.ts), roteada pro tenant certo via
 * `account.id` (aninhado, não um campo `accountId` solto — confirmado em
 * docs.zernio.com/multi-tenant/inbox).
 *
 * TODO produção: (1) verificar assinatura HMAC-SHA256 no header
 * `X-Zernio-Signature` antes de processar — não implementado ainda, então
 * por enquanto qualquer um que descubra esta URL pode forjar mensagem;
 * (2) dedupe por `event.id` (entrega é "at-least-once" segundo a doc);
 * (3) responder em até 5s e processar de fato numa fila — mesma recomendação
 * já anotada pro webhook da MKOM (seção 6.4).
 */
webhooksRouter.post("/zernio", async (req, res) => {
  const body = req.body as { account?: { id?: string } };
  const accountId = body.account?.id;

  if (!accountId) {
    return res.status(400).json({ error: "account.id ausente no callback" });
  }

  const conn = await pool.query(
    `SELECT id, tenant_id, driver FROM channel_connections
     WHERE (config->>'accountId') = $1
     LIMIT 1`,
    [accountId]
  );
  if (!conn.rows[0]) {
    console.warn(`Callback Zernio sem conexão mapeada para account.id=${accountId}`);
    return res.status(200).json({ ok: true });
  }

  const driver = getDriver(conn.rows[0].driver);
  const messages = driver.normalizeInbound(req.body);

  for (const msg of messages) {
    await ingestInboundMessage(conn.rows[0].tenant_id, conn.rows[0].id, msg);
  }

  res.status(200).json({ ok: true });
});

/**
 * SMS/RCS — MKOM registra UMA URL de callback a nível de plataforma (não por
 * tenant/conexão — ver nota operacional na seção 6.4). Por isso o roteamento
 * pro tenant certo depende do `cost_centre_id` que volta no payload, que
 * mapeamos para a conexão correspondente via `channel_connections.config`.
 */
webhooksRouter.post("/mkom", async (req, res) => {
  const body = req.body as { mailing?: { cost_centre?: { id?: number } } };
  const costCentreId = body.mailing?.cost_centre?.id;

  if (!costCentreId) {
    return res.status(400).json({ error: "cost_centre_id ausente no callback" });
  }

  const conn = await pool.query(
    `SELECT id, tenant_id, driver FROM channel_connections
     WHERE (config->>'cost_centre_id')::int = $1
     LIMIT 1`,
    [costCentreId]
  );
  if (!conn.rows[0]) {
    // Não derruba o callback com erro — a MKOM pode reenviar/desabilitar o
    // webhook se apanhar muito 4xx/5xx. Logar e responder 200 é mais seguro.
    console.warn(`Callback MKOM sem conexão mapeada para cost_centre_id=${costCentreId}`);
    return res.status(200).json({ ok: true });
  }

  const driver = getDriver(conn.rows[0].driver); // mkom_sms ou mkom_rcs
  const messages = driver.normalizeInbound(req.body);

  for (const msg of messages) {
    await ingestInboundMessage(conn.rows[0].tenant_id, conn.rows[0].id, msg);
  }

  res.status(200).json({ ok: true });
});
