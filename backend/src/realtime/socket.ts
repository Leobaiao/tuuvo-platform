/**
 * Tempo real via Socket.IO. Duas formas de entrar na mesma "sala" de tenant:
 *  - Widget de webchat (visitante anônimo): identifica-se por tenantId+widgetId
 *  - Painel do agente: identifica-se por token de tenant (authTenant.service.ts)
 * Ambos recebem `message:new` e `conversation:updated` em tempo real — é
 * assim que "múltiplos atendentes vendo a mesma coisa ao vivo" funciona,
 * e também como a transferência/nota interna avisam os dois lados na hora.
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
    const { tenantId, widgetId, token } = socket.handshake.auth as {
      tenantId?: string; widgetId?: string; token?: string;
    };

    let resolvedTenantId = tenantId;
    if (token) {
      try {
        const payload = jwt.verify(token, env.jwtSecretTenant) as { tenantId: string };
        resolvedTenantId = payload.tenantId;
      } catch {
        socket.disconnect(true);
        return;
      }
    }
    if (!resolvedTenantId) {
      socket.disconnect(true);
      return;
    }

    socket.join(tenantRoom(resolvedTenantId));
    if (widgetId) socket.join(widgetVisitorRoom(resolvedTenantId, widgetId, socket.id));

    // Mensagem enviada pelo visitante do webchat — canal nativo, sem driver externo.
    socket.on("webchat:message", async (payload: { text: string; visitorId: string }) => {
      if (!widgetId) return;
      const connectionId = await resolveWebchatConnectionId(resolvedTenantId!);
      if (!connectionId) return;

      await ingestInboundMessage(resolvedTenantId!, connectionId, {
        externalId: `${socket.id}-${Date.now()}`,
        from: payload.visitorId,
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
function widgetVisitorRoom(tenantId: string, widgetId: string, socketId: string) {
  return `visitor:${tenantId}:${widgetId}:${socketId}`;
}

export function emitToTenant(tenantId: string, event: string, data: unknown) {
  io?.to(tenantRoom(tenantId)).emit(event, data);
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
