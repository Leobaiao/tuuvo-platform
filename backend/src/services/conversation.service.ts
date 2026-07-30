/**
 * Ponto único por onde toda mensagem RECEBIDA entra no sistema, não importa
 * o canal. Garante o histórico centralizado (a promessa central do produto)
 * e aplica o dedupe de webhook "at-least-once" (achado da seção 12.2 —
 * MKOM e Zernio podem reenviar o mesmo evento).
 */
import { PoolClient } from "pg";
import { withTenantContext } from "../db/pool";
import { NormalizedMessage } from "../drivers/ChannelDriver";
import { emitToTenant } from "../realtime/socket";

export async function ingestInboundMessage(
  tenantId: string,
  channelConnectionId: string,
  normalized: NormalizedMessage
): Promise<void> {
  await withTenantContext(tenantId, false, async (client) => {
    const contact = await findOrCreateContact(client, tenantId, channelConnectionId, normalized.from);
    const conversation = await findOrCreateOpenConversation(client, tenantId, channelConnectionId, contact.id);

    // Dedupe: se `id_externo` já existe nessa conversa, o índice único
    // (schema.sql, idx_msg_dedupe) rejeita silenciosamente — não é erro,
    // é o comportamento esperado quando um provedor reenvia o mesmo evento.
    const message = await client.query(
      `INSERT INTO messages
         (tenant_id, conversation_id, remetente_tipo, conteudo, tipo,
          visivel_pro_solicitante, anexos, id_externo, enviado_em)
       VALUES ($1, $2, 'contato', $3, $4, true, $5, $6, $7)
       ON CONFLICT (conversation_id, id_externo) WHERE id_externo IS NOT NULL DO NOTHING
       RETURNING *`,
      [
        tenantId, conversation.id, normalized.content, normalized.type,
        JSON.stringify(normalized.anexos ?? []), normalized.externalId, normalized.timestamp,
      ]
    );

    if (message.rows.length === 0) return; // era duplicata, nada novo pra emitir

    emitToTenant(tenantId, "message:new", { conversationId: conversation.id, message: message.rows[0] });
  });
}

/** Cria uma NOTA INTERNA — nunca sai pro canal externo (seção 4). */
export async function criarNotaInterna(
  tenantId: string, conversationId: string, autorId: string, texto: string
): Promise<void> {
  await withTenantContext(tenantId, false, async (client) => {
    const message = await client.query(
      `INSERT INTO messages (tenant_id, conversation_id, remetente_tipo, remetente_id, conteudo, tipo, visivel_pro_solicitante)
       VALUES ($1, $2, 'agente', $3, $4, 'nota_interna', false) RETURNING *`,
      [tenantId, conversationId, autorId, texto]
    );
    emitToTenant(tenantId, "message:new", { conversationId, message: message.rows[0] });
  });
}

/** Transfere a conversa pra outra equipe/agente (seção 4). */
export async function transferirConversa(
  tenantId: string, conversationId: string, deAgenteId: string,
  paraEquipeId: string | null, paraAgenteId: string | null
): Promise<void> {
  await withTenantContext(tenantId, false, async (client) => {
    const row = await client.query(
      `UPDATE conversations
       SET equipe_id = COALESCE($1, equipe_id), atribuido_a = $2,
           transferida_de = $3, transferida_em = now(), status = 'em_atendimento'
       WHERE id = $4 RETURNING *`,
      [paraEquipeId, paraAgenteId, deAgenteId, conversationId]
    );
    emitToTenant(tenantId, "conversation:updated", row.rows[0]);
  });
}

async function findOrCreateContact(
  client: PoolClient, tenantId: string, channelConnectionId: string, identifier: string
) {
  const conn = await client.query(`SELECT tipo FROM channel_connections WHERE id = $1`, [channelConnectionId]);
  const canalOrigem = conn.rows[0]?.tipo ?? "desconhecido";

  const existing = await client.query(
    `SELECT * FROM contacts WHERE tenant_id = $1 AND canal_origem = $2 AND identificador = $3`,
    [tenantId, canalOrigem, identifier]
  );
  if (existing.rows[0]) return existing.rows[0];

  const created = await client.query(
    `INSERT INTO contacts (tenant_id, identificador, canal_origem, tipo) VALUES ($1, $2, $3, 'externo') RETURNING *`,
    [tenantId, identifier, canalOrigem]
  );
  return created.rows[0];
}

async function findOrCreateOpenConversation(
  client: PoolClient, tenantId: string, channelConnectionId: string, contactId: string
) {
  const existing = await client.query(
    `SELECT * FROM conversations
     WHERE tenant_id = $1 AND contact_id = $2 AND channel_connection_id = $3 AND status != 'fechada'
     ORDER BY aberta_em DESC LIMIT 1`,
    [tenantId, contactId, channelConnectionId]
  );
  if (existing.rows[0]) return existing.rows[0];

  const equipe = await client.query(
    `SELECT equipe_id FROM equipe_channels WHERE channel_connection_id = $1 ORDER BY padrao DESC LIMIT 1`,
    [channelConnectionId]
  );

  const created = await client.query(
    `INSERT INTO conversations (tenant_id, channel_connection_id, equipe_id, contact_id, status)
     VALUES ($1, $2, $3, $4, 'aberta') RETURNING *`,
    [tenantId, channelConnectionId, equipe.rows[0]?.equipe_id ?? null, contactId]
  );
  return created.rows[0];
}
