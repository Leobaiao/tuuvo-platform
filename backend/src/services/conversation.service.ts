import { PoolClient } from "pg";
import { withTenantContext } from "../db/pool";
import { NormalizedMessage } from "../drivers/ChannelDriver";
import { emitToTenant } from "../realtime/socket";

/**
 * Ponto único por onde toda mensagem recebida entra no sistema, não importa
 * o canal (webchat, WhatsApp, SMS, RCS). Garante que o histórico fica
 * centralizado (promessa da seção 1: "todas as conversas, um único lugar").
 */
export async function ingestInboundMessage(
  tenantId: string,
  channelConnectionId: string,
  normalized: NormalizedMessage
): Promise<void> {
  await withTenantContext(tenantId, false, async (client) => {
    const contact = await findOrCreateContact(
      client,
      tenantId,
      channelConnectionId,
      normalized.from
    );

    const conversation = await findOrCreateOpenConversation(
      client,
      tenantId,
      channelConnectionId,
      contact.id
    );

    const message = await client.query(
      `INSERT INTO messages (tenant_id, conversation_id, remetente_tipo, conteudo, tipo, id_externo, enviado_em)
       VALUES ($1, $2, 'contato', $3, $4, $5, $6)
       RETURNING *`,
      [
        tenantId,
        conversation.id,
        normalized.content,
        normalized.type,
        normalized.externalId,
        normalized.timestamp,
      ]
    );

    emitToTenant(tenantId, "message:new", {
      conversationId: conversation.id,
      message: message.rows[0],
    });
  });
}

async function findOrCreateContact(
  client: PoolClient,
  tenantId: string,
  channelConnectionId: string,
  identifier: string
) {
  const conn = await client.query(
    `SELECT tipo FROM channel_connections WHERE id = $1`,
    [channelConnectionId]
  );
  const canalOrigem = conn.rows[0]?.tipo ?? "desconhecido";

  const existing = await client.query(
    `SELECT * FROM contacts WHERE tenant_id = $1 AND canal_origem = $2 AND identificador = $3`,
    [tenantId, canalOrigem, identifier]
  );
  if (existing.rows[0]) return existing.rows[0];

  const created = await client.query(
    `INSERT INTO contacts (tenant_id, identificador, canal_origem)
     VALUES ($1, $2, $3) RETURNING *`,
    [tenantId, identifier, canalOrigem]
  );
  return created.rows[0];
}

async function findOrCreateOpenConversation(
  client: PoolClient,
  tenantId: string,
  channelConnectionId: string,
  contactId: string
) {
  const existing = await client.query(
    `SELECT * FROM conversations
     WHERE tenant_id = $1 AND contact_id = $2 AND channel_connection_id = $3
       AND status != 'fechada'
     ORDER BY aberta_em DESC LIMIT 1`,
    [tenantId, contactId, channelConnectionId]
  );
  if (existing.rows[0]) return existing.rows[0];

  // Departamento padrão da conexão (seção 7) — se não houver nenhum marcado
  // como padrão, cai no primeiro departamento vinculado.
  const dept = await client.query(
    `SELECT department_id FROM department_channels
     WHERE channel_connection_id = $1
     ORDER BY padrao DESC LIMIT 1`,
    [channelConnectionId]
  );

  const created = await client.query(
    `INSERT INTO conversations (tenant_id, channel_connection_id, department_id, contact_id, status)
     VALUES ($1, $2, $3, $4, 'aberta') RETURNING *`,
    [tenantId, channelConnectionId, dept.rows[0]?.department_id ?? null, contactId]
  );
  return created.rows[0];
}
