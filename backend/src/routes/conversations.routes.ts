import { Router } from "express";
import { z } from "zod";
import { withTenantContext } from "../db/pool";
import { requireAuth } from "../middleware/auth";
import { getDriver } from "../drivers/registry";
import { emitToTenant } from "../realtime/socket";

export const conversationsRouter = Router();
conversationsRouter.use(requireAuth);

conversationsRouter.get("/", async (req, res) => {
  if (!req.auth?.tenantId) return res.status(403).json({ error: "Sem tenant" });

  const status = (req.query.status as string) ?? "aberta";
  const rows = await withTenantContext(req.auth.tenantId, false, (client) =>
    client.query(
      `SELECT c.*, ct.identificador AS contato, ct.nome AS contato_nome,
              d.nome AS departamento, cc.tipo AS canal, cc.nome AS canal_nome,
              u.nome AS atribuido_nome,
              (SELECT conteudo FROM messages m WHERE m.conversation_id = c.id
                 ORDER BY m.enviado_em DESC LIMIT 1) AS ultima_mensagem
       FROM conversations c
       JOIN contacts ct ON ct.id = c.contact_id
       JOIN channel_connections cc ON cc.id = c.channel_connection_id
       LEFT JOIN departments d ON d.id = c.department_id
       LEFT JOIN users u ON u.id = c.atribuido_a
       WHERE c.status = $1
       ORDER BY c.aberta_em DESC`,
      [status]
    )
  );
  res.json(rows.rows);
});

conversationsRouter.get("/:id/messages", async (req, res) => {
  if (!req.auth?.tenantId) return res.status(403).json({ error: "Sem tenant" });
  const rows = await withTenantContext(req.auth.tenantId, false, (client) =>
    client.query(
      `SELECT * FROM messages WHERE conversation_id = $1 ORDER BY enviado_em`,
      [req.params.id]
    )
  );
  res.json(rows.rows);
});

// Atribuição de conversa a um agente — suporte a múltiplos agentes atendendo
// em paralelo sem colidir: quando alguém "pega" a conversa, todo mundo no
// painel vê em tempo real (evento conversation:updated) quem está com ela.
const assignSchema = z.object({ agenteId: z.string().uuid().nullable() });

conversationsRouter.patch("/:id/assign", async (req, res) => {
  if (!req.auth?.tenantId) return res.status(403).json({ error: "Sem tenant" });
  const parsed = assignSchema.safeParse(req.body);
  if (!parsed.success) return res.status(400).json({ error: parsed.error.flatten() });

  const tenantId = req.auth.tenantId;
  const row = await withTenantContext(tenantId, false, (client) =>
    client.query(
      `UPDATE conversations SET atribuido_a = $1,
              status = CASE WHEN $1 IS NOT NULL THEN 'em_atendimento' ELSE 'aberta' END
       WHERE id = $2 RETURNING *`,
      [parsed.data.agenteId, req.params.id]
    )
  );
  if (!row.rows[0]) return res.status(404).json({ error: "Conversa não encontrada" });

  emitToTenant(tenantId, "conversation:updated", row.rows[0]);
  res.json(row.rows[0]);
});

conversationsRouter.patch("/:id/close", async (req, res) => {
  if (!req.auth?.tenantId) return res.status(403).json({ error: "Sem tenant" });
  const tenantId = req.auth.tenantId;
  const row = await withTenantContext(tenantId, false, (client) =>
    client.query(
      `UPDATE conversations SET status = 'fechada', fechada_em = now()
       WHERE id = $1 RETURNING *`,
      [req.params.id]
    )
  );
  if (!row.rows[0]) return res.status(404).json({ error: "Conversa não encontrada" });

  emitToTenant(tenantId, "conversation:updated", row.rows[0]);
  res.json(row.rows[0]);
});

const replySchema = z.object({ texto: z.string().min(1) });

conversationsRouter.post("/:id/reply", async (req, res) => {
  if (!req.auth?.tenantId) return res.status(403).json({ error: "Sem tenant" });
  const parsed = replySchema.safeParse(req.body);
  if (!parsed.success) return res.status(400).json({ error: parsed.error.flatten() });

  const tenantId = req.auth.tenantId;

  const info = await withTenantContext(tenantId, false, (client) =>
    client.query(
      `SELECT c.id, c.channel_connection_id, ct.identificador AS destino,
              cc.driver, cc.id AS conn_id
       FROM conversations c
       JOIN contacts ct ON ct.id = c.contact_id
       JOIN channel_connections cc ON cc.id = c.channel_connection_id
       WHERE c.id = $1`,
      [req.params.id]
    )
  );
  const conversation = info.rows[0];
  if (!conversation) return res.status(404).json({ error: "Conversa não encontrada" });

  // Canal nativo (webchat) só emite via socket; canais externos passam pelo driver.
  if (conversation.driver !== "webchat_native") {
    const driver = getDriver(conversation.driver);
    await driver.sendText(conversation.conn_id, {
      to: conversation.destino,
      text: parsed.data.texto,
    });
  }

  const message = await withTenantContext(tenantId, false, (client) =>
    client.query(
      `INSERT INTO messages (tenant_id, conversation_id, remetente_tipo, remetente_id, conteudo, tipo)
       VALUES ($1, $2, 'agente', $3, $4, 'texto') RETURNING *`,
      [tenantId, req.params.id, req.auth!.userId, parsed.data.texto]
    )
  );

  emitToTenant(tenantId, "message:new", {
    conversationId: req.params.id,
    message: message.rows[0],
  });

  res.status(201).json(message.rows[0]);
});
