/**
 * Driver de WhatsApp não-oficial via GTI API.
 * Base: https://api.gtiapi.workers.dev · Auth: header `token: <token da instância>`.
 * Fonte: collection "GTI API | v3 Botões" fornecida pelo cliente.
 *
 * ⚠️ NOTA DE RISCO — leia antes de mexer no menu/botão deste driver:
 * O endpoint /send/menu (poll/list/button/carousel) quase certamente usa o
 * mecanismo `NativeFlowMessage` do protocolo WhatsApp — a forma mais recente
 * de simular botão interativo em biblioteca não-oficial. Confirmado via
 * pesquisa (GitHub issues da Baileys e da whatsmeow, ambas bibliotecas
 * relatam o WhatsApp bloqueando o `ButtonsMessage` clássico e recomendando
 * migrar pra esse mecanismo mais novo, que ainda é instável na comunidade
 * open-source). Ou seja: a GTI provavelmente investe em manter esse patch
 * funcionando — e ele pode parar de funcionar a qualquer momento se a Meta
 * mudar de novo o protocolo. Não é bug deste código, é característica de
 * qualquer WhatsApp não-oficial. Se `sendMenu` começar a falhar/parar de
 * mostrar botão pro usuário final, ISSO é o sintoma esperado desse risco —
 * não assuma erro de implementação antes de checar isso.
 *
 * Trocar de fornecedor (se GTI parar de funcionar bem) = escrever um driver
 * novo implementando a mesma interface ChannelDriver — nenhum outro arquivo
 * do projeto precisa mudar.
 */
import { env } from "../config/env";
import {
  ChannelDriver,
  ConnectionStatus,
  NormalizedMessage,
  SendMenuParams,
  SendTextParams,
} from "./ChannelDriver";

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
    headers: { "Content-Type": "application/json", token, ...(init.headers ?? {}) },
  });
  if (!res.ok) {
    const body = await res.text().catch(() => "");
    throw new Error(`GTI API ${path} falhou (${res.status}): ${body}`);
  }
  return res.json() as Promise<T>;
}

// Em produção isso deveria vir do banco (channel_connections.credenciais_enc),
// carregado por conexão — aqui simplificado pra registro em memória por processo.
const tokenByConnection = new Map<string, string>();

export function registerGtiConnection(connectionId: string, creds: GtiCredentials) {
  tokenByConnection.set(connectionId, creds.token);
}

function tokenFor(connectionId: string): string {
  const token = tokenByConnection.get(connectionId);
  if (!token) {
    throw new Error(
      `Conexão GTI ${connectionId} sem token carregado — chame registerGtiConnection() antes de usar.`
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
    const data = await gtiRequest<{ qrcode?: string; paircode?: string }>(
      "/instance/connect",
      creds.token,
      { method: "POST", body: JSON.stringify(body) }
    );
    return { status: "qr_pending" as ConnectionStatus, qrCode: data.qrcode, pairCode: data.paircode };
  },

  async getStatus(connectionId) {
    const token = tokenFor(connectionId);
    const data = await gtiRequest<{ status: string }>("/instance/status", token, { method: "GET" });
    if (data.status === "connected" || data.status === "open") return "conectado";
    if (data.status === "qr" || data.status === "qr_pending") return "qr_pending";
    return "desconectado";
  },

  async sendText(connectionId, params: SendTextParams) {
    const token = tokenFor(connectionId);
    const data = await gtiRequest<{ id?: string; messageid?: string }>("/send/text", token, {
      method: "POST",
      body: JSON.stringify({
        number: params.to,
        text: params.text,
        linkPreview: false,
        replyid: params.replyToExternalId ?? "",
        mentions: "",
        readchat: true,
        delay: 0,
      }),
    });
    return { externalId: data.id ?? data.messageid ?? "" };
  },

  // Ver nota de risco no cabeçalho do arquivo antes de depender disso em produção.
  async sendMenu(connectionId, params: SendMenuParams) {
    const token = tokenFor(connectionId);
    const choices = params.options.map((opt) => {
      if (opt.type === "url") return `${opt.label}|${opt.value}`;
      if (opt.type === "call") return `${opt.label}|call:${opt.value}`;
      return `${opt.label}|copy:${opt.value}`;
    });
    const data = await gtiRequest<{ id?: string; messageid?: string }>("/send/menu", token, {
      method: "POST",
      body: JSON.stringify({
        number: params.to,
        type: params.style,
        text: params.text,
        footerText: params.footer ?? "",
        listButton: "Selecione",
        selectableCount: 1,
        choices,
        mentions: "",
        readchat: true,
        delay: 0,
      }),
    });
    return { externalId: data.id ?? data.messageid ?? "" };
  },

  normalizeInbound(payload: unknown): NormalizedMessage[] {
    const body = payload as {
      event?: string;
      data?: Array<{
        id?: string;
        from?: string;
        to?: string;
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
