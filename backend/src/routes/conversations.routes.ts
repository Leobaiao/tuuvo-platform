import { Router } from "express";
import { z } from "zod";
import { withTenantContext } from "../db/pool";
import { requireTenantAuthOrApiKey } from "../middleware/auth";
import { getDriver } from "../drivers/registry";
import { emitToTenant } from "../realtime/socket";
import { criarNotaInterna, transferirConversa } from "../services/conversation.service";

export const conversationsRouter = Router();
conversationsRouter.use(requireTenantAuthOrApiKey);

conversationsRouter.get("/", async (req, res) => {
  if (!req.tenantAuth?.tenantId) return res.status(403).json({ error: "Sem tenant" });
  const status = (req.query.status as string) ?? "aberta";
  const rows = await withTenantContext(req.tenantAuth.tenantId, false, (client) =>
    client.query(
      `SELECT c.*, ct.identificador AS contato, ct.nome AS contato_nome, ct.tipo AS contato_tipo,
              e.nome AS equipe, cc.tipo AS canal, cc.nome AS canal_nome, u.nome AS atribuido_nome,
              (SELECT conteudo FROM messages m WHERE m.conversation_id = c.id AND m.visivel_pro_solicitante = true
                 ORDER BY m.enviado_em DESC LIMIT 1) AS ultima_mensagem
       FROM conversations c
       JOIN contacts ct ON ct.id = c.contact_id
       JOIN channel_connections cc ON cc.id = c.channel_connection_id
       LEFT JOIN equipes e ON e.id = c.equipe_id
       LEFT JOIN users u ON u.id = c.atribuido_a
       WHERE c.status = $1 ORDER BY c.aberta_em DESC`,
      [status]
    )
  );
  res.json(rows.rows);
});

conversationsRouter.get("/:id/messages", async (req, res) => {
  if (!req.tenantAuth?.tenantId) return res.status(403).json({ error: "Sem tenant" });
  const incluirNotas = req.query.incluirNotas === "true";
  const rows = await withTenantContext(req.tenantAuth.tenantId, false, (client) =>
    client.query(
      `SELECT * FROM messages WHERE conversation_id = $1 ${incluirNotas ? "" : "AND visivel_pro_solicitante = true"}
       ORDER BY enviado_em`,
      [req.params.id]
    )
  );
  res.json(rows.rows);
});

const replySchema = z.object({ texto: z.string().min(1) });

conversationsRouter.post("/:id/reply", async (req, res) => {
  if (!req.tenantAuth?.tenantId) return res.status(403).json({ error: "Sem tenant" });
  const parsed = replySchema.safeParse(req.body);
  if (!parsed.success) return res.status(400).json({ error: parsed.error.flatten() });
  const tenantId = req.tenantAuth.tenantId;

  const info = await withTenantContext(tenantId, false, (client) =>
    client.query(
      `SELECT c.id, ct.identificador AS destino, cc.driver, cc.id AS conn_id, cc.tipo AS canal_tipo
       FROM conversations c
       JOIN contacts ct ON ct.id = c.contact_id
       JOIN channel_connections cc ON cc.id = c.channel_connection_id
       WHERE c.id = $1`,
      [req.params.id]
    )
  );
  const conversation = info.rows[0];
  if (!conversation) return res.status(404).json({ error: "Conversa não encontrada" });

  // Categoria de cobrança (seção 14) — só se aplica a canal com tarifa da
  // Meta/MKOM. GTI (não-oficial), webchat e e-mail não têm categoria (NULL).
  // Toda resposta livre do agente = "service" no WhatsApp oficial (não é
  // template); RCS mapeia por tipo de conteúdo — "simples" por padrão aqui,
  // já que o reply padrão é sempre texto simples (mídia teria outro fluxo).
  let categoriaCobranca: string | null = null;
  if (conversation.canal_tipo === "whatsapp_zernio") categoriaCobranca = "service";
  if (conversation.canal_tipo === "rcs") categoriaCobranca = "simples";

  if (conversation.driver !== "webchat_native") {
    const driver = getDriver(conversation.driver);
    await driver.sendText(conversation.conn_id, {
      to: conversation.destino, text: parsed.data.texto, categoriaCobranca: categoriaCobranca ?? undefined,
    });
  }

  const message = await withTenantContext(tenantId, false, (client) =>
    client.query(
      `INSERT INTO messages (tenant_id, conversation_id, remetente_tipo, remetente_id, conteudo, tipo, visivel_pro_solicitante, categoria_cobranca)
       VALUES ($1,$2,'agente',$3,$4,'texto', true, $5) RETURNING *`,
      [tenantId, req.params.id, req.tenantAuth!.userId, parsed.data.texto, categoriaCobranca]
    )
  );
  emitToTenant(tenantId, "message:new", { conversationId: req.params.id, message: message.rows[0] });
  res.status(201).json(message.rows[0]);
});

// --- Nota interna (arquitetura v2, seção 4) — nunca sai pro canal externo ---
const notaSchema = z.object({ texto: z.string().min(1) });

conversationsRouter.post("/:id/nota-interna", async (req, res) => {
  if (!req.tenantAuth?.tenantId) return res.status(403).json({ error: "Sem tenant" });
  const parsed = notaSchema.safeParse(req.body);
  if (!parsed.success) return res.status(400).json({ error: parsed.error.flatten() });
  await criarNotaInterna(req.tenantAuth.tenantId, req.params.id, req.tenantAuth.userId, parsed.data.texto);
  res.status(201).json({ ok: true });
});

// --- Transferência (seção 4) ---
const transferirSchema = z.object({
  paraEquipeId: z.string().uuid().nullable().default(null),
  paraAgenteId: z.string().uuid().nullable().default(null),
});

conversationsRouter.post("/:id/transferir", async (req, res) => {
  if (!req.tenantAuth?.tenantId) return res.status(403).json({ error: "Sem tenant" });
  const parsed = transferirSchema.safeParse(req.body);
  if (!parsed.success) return res.status(400).json({ error: parsed.error.flatten() });
  await transferirConversa(
    req.tenantAuth.tenantId, req.params.id, req.tenantAuth.userId,
    parsed.data.paraEquipeId, parsed.data.paraAgenteId
  );
  res.status(200).json({ ok: true });
});

conversationsRouter.patch("/:id/close", async (req, res) => {
  if (!req.tenantAuth?.tenantId) return res.status(403).json({ error: "Sem tenant" });
  const tenantId = req.tenantAuth.tenantId;
  const row = await withTenantContext(tenantId, false, (client) =>
    client.query(`UPDATE conversations SET status = 'fechada', fechada_em = now() WHERE id = $1 RETURNING *`, [req.params.id])
  );
  if (!row.rows[0]) return res.status(404).json({ error: "Conversa não encontrada" });
  emitToTenant(tenantId, "conversation:updated", row.rows[0]);
  res.json(row.rows[0]);
});

// --- Exportar conversa (seção 4) — texto simples, notas internas opcionais ---
conversationsRouter.get("/:id/export", async (req, res) => {
  if (!req.tenantAuth?.tenantId) return res.status(403).json({ error: "Sem tenant" });
  const incluirNotas = req.query.incluirNotas === "true";
  const rows = await withTenantContext(req.tenantAuth.tenantId, false, (client) =>
    client.query(
      `SELECT remetente_tipo, conteudo, tipo, visivel_pro_solicitante, enviado_em FROM messages
       WHERE conversation_id = $1 ${incluirNotas ? "" : "AND visivel_pro_solicitante = true"}
       ORDER BY enviado_em`,
      [req.params.id]
    )
  );
  const texto = rows.rows
    .map((m) => {
      const marca = m.visivel_pro_solicitante ? "" : " [NOTA INTERNA]";
      return `[${new Date(m.enviado_em).toLocaleString("pt-BR")}] ${m.remetente_tipo}${marca}: ${m.conteudo}`;
    })
    .join("\n");
  res.setHeader("Content-Type", "text/plain; charset=utf-8");
  res.setHeader("Content-Disposition", `attachment; filename="conversa-${req.params.id}.txt"`);
  res.send(texto);
});
