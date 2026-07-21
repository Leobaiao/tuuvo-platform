import { env } from "../config/env";
import {
  ChannelDriver,
  ConnectionStatus,
  NormalizedMessage,
  SendMenuParams,
  SendTextParams,
} from "./ChannelDriver";

/**
 * Driver de WhatsApp não-oficial via GTI API.
 * Base: https://api.gtiapi.workers.dev
 * Cada `channel_connection` de tipo "whatsapp" = 1 instância GTI = 1 token.
 * Auth: header `token: <token da instância>`.
 * Doc de origem: collection "GTI API | v3 Botões" (ver seção 6.2 da especificação).
 */

interface GtiCredentials {
  token: string;
}

async function gtiRequest<T>(
  path: string,
  token: string,
  init: RequestInit = {}
): Promise<T> {
  const res = await fetch(`${env.gtiBaseUrl}${path}`, {
    ...init,
    headers: {
      "Content-Type": "application/json",
      token,
      ...(init.headers ?? {}),
    },
  });
  if (!res.ok) {
    const body = await res.text().catch(() => "");
    throw new Error(`GTI API ${path} falhou (${res.status}): ${body}`);
  }
  return res.json() as Promise<T>;
}

// Mantido em memória por processo — em produção, trocar por lookup no banco
// (channel_connections.credenciais_enc), aqui simplificado para o scaffold.
const tokenByConnection = new Map<string, string>();

export function registerGtiConnection(connectionId: string, creds: GtiCredentials) {
  tokenByConnection.set(connectionId, creds.token);
}

function tokenFor(connectionId: string): string {
  const token = tokenByConnection.get(connectionId);
  if (!token) {
    throw new Error(
      `Conexão GTI ${connectionId} não tem token carregado — chame registerGtiConnection() ao inicializar.`
    );
  }
  return token;
}

export const whatsAppGtiDriver: ChannelDriver = {
  name: "whatsapp_gti",

  async connect(connectionId, credentials) {
    const creds = credentials as unknown as GtiCredentials;
    registerGtiConnection(connectionId, creds);

    const body = credentials.phone ? { phone: credentials.phone } : {};
    const data = await gtiRequest<{
      qrcode?: string;
      paircode?: string;
    }>("/instance/connect", creds.token, {
      method: "POST",
      body: JSON.stringify(body),
    });

    return {
      status: "qr_pending" as ConnectionStatus,
      qrCode: data.qrcode,
      pairCode: data.paircode,
    };
  },

  async getStatus(connectionId) {
    const token = tokenFor(connectionId);
    const data = await gtiRequest<{ status: string }>(
      "/instance/status",
      token,
      { method: "GET" }
    );
    // A GTI retorna estados próprios; normalizamos para o enum interno.
    if (data.status === "connected" || data.status === "open") return "conectado";
    if (data.status === "qr" || data.status === "qr_pending") return "qr_pending";
    return "desconectado";
  },

  async sendText(connectionId, params: SendTextParams) {
    const token = tokenFor(connectionId);
    const data = await gtiRequest<{ id?: string; messageid?: string }>(
      "/send/text",
      token,
      {
        method: "POST",
        headers: { convert: "true" },
        body: JSON.stringify({
          number: params.to,
          text: params.text,
          linkPreview: false,
          replyid: params.replyToExternalId ?? "",
          mentions: "",
          readchat: true,
          delay: 0,
        }),
      }
    );
    return { externalId: data.id ?? data.messageid ?? "" };
  },

  async sendMenu(connectionId, params: SendMenuParams) {
    const token = tokenFor(connectionId);

    // Traduz o formato interno (options com type/label/value) para o formato
    // de "choices" da GTI: "label|copy:valor" (reply/copy), "label|url" (url),
    // "label|call:valor" (ligação) — conforme exemplo real da collection.
    const choices = params.options.map((opt) => {
      if (opt.type === "url") return `${opt.label}|${opt.value}`;
      if (opt.type === "call") return `${opt.label}|call:${opt.value}`;
      return `${opt.label}|copy:${opt.value}`;
    });

    const data = await gtiRequest<{ id?: string; messageid?: string }>(
      "/send/menu",
      token,
      {
        method: "POST",
        body: JSON.stringify({
          number: params.to,
          type: params.style, // poll | list | button | carousel
          text: params.text,
          footerText: params.footer ?? "",
          listButton: "Selecione",
          selectableCount: 1,
          choices,
          mentions: "",
          readchat: true,
          delay: 0,
        }),
      }
    );
    return { externalId: data.id ?? data.messageid ?? "" };
  },

  normalizeInbound(payload: unknown): NormalizedMessage[] {
    // Formato de webhook da GTI: { event: "messages", data: [...] } (ou SSE equivalente).
    const body = payload as {
      event?: string;
      data?: Array<{
        id?: string;
        from?: string;
        to?: string;
        type?: string;
        text?: { message?: string };
        timestamp?: number;
      }>;
    };

    if (body.event !== "messages" || !Array.isArray(body.data)) return [];

    return body.data.map((msg) => ({
      externalId: msg.id ?? "",
      from: msg.from ?? "",
      to: msg.to,
      type: "texto",
      content: msg.text?.message ?? "",
      raw: msg,
      timestamp: msg.timestamp ? new Date(msg.timestamp * 1000) : new Date(),
    }));
  },
};
