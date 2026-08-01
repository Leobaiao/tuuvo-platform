/**
 * Tempo real via Socket.IO. Duas formas MUITO diferentes de conexão, com
 * isolamento explícito entre elas:
 *  - Painel do agente (token de tenant válido): entra na sala geral do
 *    tenant — vê TODAS as conversas, é assim que "múltiplos atendentes
 *    vendo tudo ao vivo" funciona.
 *  - Widget de webchat (visitante anônimo, tenantId+widgetId+visitorId):
 *    entra SÓ na própria sala, isolada por visitorId — nunca na sala geral.
 *
 * ⚠️ Bug real corrigido aqui (não documentação, comportamento errado que
 * existia antes): visitante entrava na MESMA sala geral do tenant que os
 * agentes, então recebia `message:new` de QUALQUER conversa daquele
 * tenant — um visitante veria a resposta destinada a outro visitante
 * completamente diferente. Corrigido separando as salas por completo.
 */
import { Server as HttpServer } from "http";
import { Server as SocketIOServer, Socket } from "socket.io";
import jwt from "jsonwebtoken";
import { env } from "../config/env";
import { ingestInboundMessage } from "../services/conversation.service";
import { withTenantContext } from "../db/pool";

let io: SocketIOServer;

export function initRealtime(server: HttpServer): SocketIOServer {
  io = new SocketIOServer(server, { cors: { origin: "*" } });

  io.on("connection", (socket: Socket) => {
    const { tenantId, widgetId, visitorId, token } = socket.handshake.auth as {
      tenantId?: string; widgetId?: string; visitorId?: string; token?: string;
    };

    // Caminho do AGENTE — token válido, entra na sala geral do tenant.
    if (token) {
      let resolvedTenantId: string;
      try {
        const payload = jwt.verify(token, env.jwtSecretTenant) as { tenantId: string };
        resolvedTenantId = payload.tenantId;
      } catch {
        socket.disconnect(true);
        return;
      }
      socket.join(tenantRoom(resolvedTenantId));
      return;
    }

    // Caminho do VISITANTE ANÔNIMO — nunca entra na sala geral, só na própria.
    if (!tenantId || !widgetId || !visitorId) {
      socket.disconnect(true);
      return;
    }
    socket.join(visitorRoom(tenantId, visitorId));

    socket.on("webchat:message", async (payload: { text: string }) => {
      const connectionId = await resolveWebchatConnectionId(tenantId);
      if (!connectionId) return;

      await ingestInboundMessage(tenantId, connectionId, {
        externalId: `${socket.id}-${Date.now()}`,
        from: visitorId,
        type: "texto",
        content: payload.text,
        raw: payload,
        timestamp: new Date(),
      });
    });
  });

  return io;
}

function tenantRoom(tenantId: string) { return `tenant:${tenantId}`; }
function visitorRoom(tenantId: string, visitorId: string) { return `visitor:${tenantId}:${visitorId}`; }

/** Avisa TODOS os agentes do tenant — usado pelo painel (inbox em tempo real). */
export function emitToTenant(tenantId: string, event: string, data: unknown) {
  io?.to(tenantRoom(tenantId)).emit(event, data);
}

/** Avisa só UM visitante específico — usado quando o agente responde (seção 15). */
export function emitToVisitor(tenantId: string, visitorId: string, event: string, data: unknown) {
  io?.to(visitorRoom(tenantId, visitorId)).emit(event, data);
}

async function resolveWebchatConnectionId(tenantId: string): Promise<string | null> {
  const result = await withTenantContext(tenantId, false, (client) =>
    client.query(
      `SELECT id FROM channel_connections WHERE tenant_id = $1 AND tipo = 'webchat' AND ativo = true LIMIT 1`,
      [tenantId]
    )
  );
  return result.rows[0]?.id ?? null;
}
