import { Server as HttpServer } from "http";
import { Server as SocketIOServer, Socket } from "socket.io";
import jwt from "jsonwebtoken";
import { env } from "../config/env";
import { ingestInboundMessage } from "../services/conversation.service";
import { withTenantContext } from "../db/pool";

let io: SocketIOServer;

/**
 * Duas formas de conexão no mesmo namespace:
 *  - Widget de webchat embutido no site do cliente: identifica-se com
 *    `tenantId` + `widgetId` públicos (sem login — é um visitante anônimo).
 *  - Painel do agente: identifica-se com JWT (mesmo token do REST).
 * Ambos entram na "sala" do tenant para receber `message:new` em tempo real.
 */
export function initRealtime(server: HttpServer): SocketIOServer {
  io = new SocketIOServer(server, { cors: { origin: "*" } });

  io.on("connection", (socket: Socket) => {
    const { tenantId, widgetId, token } = socket.handshake.auth as {
      tenantId?: string;
      widgetId?: string;
      token?: string;
    };

    let resolvedTenantId = tenantId;

    if (token) {
      try {
        const payload = jwt.verify(token, env.jwtSecret) as { tenantId: string | null };
        resolvedTenantId = payload.tenantId ?? undefined;
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

    // Mensagem enviada pelo visitante do webchat (canal nativo — sem driver externo).
    socket.on("webchat:message", async (payload: { text: string; visitorId: string }) => {
      if (!widgetId) return; // só o widget usa este evento

      const connectionId = await resolveWebchatConnectionId(resolvedTenantId!, widgetId);
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

function tenantRoom(tenantId: string) {
  return `tenant:${tenantId}`;
}
function widgetVisitorRoom(tenantId: string, widgetId: string, socketId: string) {
  return `visitor:${tenantId}:${widgetId}:${socketId}`;
}

export function emitToTenant(tenantId: string, event: string, data: unknown) {
  io?.to(tenantRoom(tenantId)).emit(event, data);
}

async function resolveWebchatConnectionId(
  tenantId: string,
  _widgetId: string
): Promise<string | null> {
  // Simplificação do scaffold: pega a primeira conexão webchat ativa do tenant.
  // Numa versão completa, o widget carregaria isso ligado ao bot_widgets.id.
  const result = await withTenantContext(tenantId, false, (client) =>
    client.query(
      `SELECT id FROM channel_connections
       WHERE tenant_id = $1 AND tipo = 'webchat' AND ativo = true
       LIMIT 1`,
      [tenantId]
    )
  );
  return result.rows[0]?.id ?? null;
}
