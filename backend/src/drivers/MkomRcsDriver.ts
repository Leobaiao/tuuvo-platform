/**
 * Driver de RCS via broker MKOM.
 * SMS foi removido do escopo (decisão explícita: não é canal de conversa
 * usual no Brasil — arquitetura v2, seção 3.5). Este driver cobre só RCS.
 *
 * Preço confirmado com a MKOM: R$0,09 a R$0,15/mensagem (usamos o teto por
 * conservadorismo — ver TUUVO_Modelo_Financeiro.xlsx, aba Premissas).
 * Auth: header `Authorization: Bearer <token>` (token de PLATAFORMA, não por
 * tenant — igual Zernio, guardado em platform_channel_providers).
 */
import { env } from "../config/env";
import { ChannelDriver, NormalizedMessage, SendMenuParams, SendTextParams } from "./ChannelDriver";

interface MkomCredentials {
  token: string;
  costCentreId: number; // mapeia pro tenant/equipe — ver nota de webhook único abaixo
}

async function mkomRequest<T>(token: string, body: unknown): Promise<T> {
  const res = await fetch(env.mkomRcsBaseUrl, {
    method: "POST",
    headers: { "Content-Type": "application/json", Accept: "application/json", Authorization: `Bearer ${token}` },
    body: JSON.stringify(body),
  });
  if (!res.ok) {
    const text = await res.text().catch(() => "");
    throw new Error(`MKOM API falhou (${res.status}): ${text}`);
  }
  return res.json() as Promise<T>;
}

const credsByConnection = new Map<string, MkomCredentials>();

export function registerMkomConnection(connectionId: string, creds: MkomCredentials) {
  credsByConnection.set(connectionId, creds);
}

function credsFor(connectionId: string): MkomCredentials {
  const creds = credsByConnection.get(connectionId);
  if (!creds) throw new Error(`Conexão MKOM ${connectionId} sem credenciais carregadas.`);
  return creds;
}

export const rcsMkomDriver: ChannelDriver = {
  name: "mkom_rcs",

  async connect() {
    // API stateless autenticada por token de plataforma — sem QR/pareamento.
    return { status: "conectado" as const };
  },

  async getStatus() {
    return "conectado" as const;
  },

  async sendText(connectionId, params: SendTextParams) {
    const creds = credsFor(connectionId);
    const data = await mkomRequest<{ data?: { id?: number; uid?: string } }>(creds.token, {
      mailing: { identifier: "TUUVO RCS", cost_centre_id: creds.costCentreId },
      messages: [{
        msisdn: params.to,
        message: params.text, // fallback SMS automático do broker se RCS falhar
        rcs_type: "text",
        content: { text: params.text },
      }],
    });
    return { externalId: String(data.data?.uid ?? data.data?.id ?? "") };
  },

  async sendMenu(connectionId, params: SendMenuParams) {
    const creds = credsFor(connectionId);
    const suggestions = params.options.map((opt) => {
      if (opt.type === "url") return { type: "OPEN_URL", text: opt.label, url: opt.value };
      if (opt.type === "call") return { type: "DIAL_PHONE", text: opt.label, phone_number: opt.value };
      return { type: "REPLY", text: opt.label, postback_data: opt.value };
    });
    const data = await mkomRequest<{ data?: { id?: number; uid?: string } }>(creds.token, {
      mailing: { identifier: "TUUVO RCS Menu", cost_centre_id: creds.costCentreId },
      messages: [{
        msisdn: params.to,
        message: params.text,
        rcs_type: "text",
        content: { text: params.text, suggestions },
      }],
    });
    return { externalId: String(data.data?.uid ?? data.data?.id ?? "") };
  },

  normalizeInbound(payload: unknown): NormalizedMessage[] {
    // Callback de status/resposta — URL ÚNICA a nível de plataforma (a MKOM
    // não registra webhook por instância/tenant), roteado pelo cost_centre_id
    // que volta no payload. Ver webhooks.routes.ts.
    const body = payload as {
      internal_id?: number;
      message?: string;
      msisdn?: string;
      timestamp?: number;
      mailing?: { cost_centre?: { id?: number } };
    };
    if (!body.msisdn) return [];
    return [{
      externalId: String(body.internal_id ?? ""),
      from: body.msisdn,
      type: "texto",
      content: body.message ?? "",
      raw: body,
      timestamp: body.timestamp ? new Date(body.timestamp * 1000) : new Date(),
    }];
  },
};
