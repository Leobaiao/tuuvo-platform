import { env } from "../config/env";
import {
  ChannelDriver,
  NormalizedMessage,
  SendMenuParams,
  SendTextParams,
} from "./ChannelDriver";

/**
 * Driver de SMS e RCS via broker MKOM (módulo MKSMS).
 * Mesmo endpoint para os dois canais — diferenciado pelo campo `rcs_type`.
 * Auth: header `Authorization: Bearer <token>` (token de plataforma, não por tenant —
 * ver platform_channel_providers no schema e seção 5 da especificação).
 * Doc de origem: "Documentação de APIs - MKOM".
 */

interface MkomCredentials {
  token: string;
  costCentreId: number; // mapeia para o departamento/tenant, ver seção 6.4
}

async function mkomRequest<T>(
  token: string,
  body: unknown
): Promise<T> {
  const res = await fetch(env.mkomSmsBaseUrl, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      Accept: "application/json",
      Authorization: `Bearer ${token}`,
    },
    body: JSON.stringify(body),
  });
  if (!res.ok) {
    const text = await res.text().catch(() => "");
    throw new Error(`MKOM API falhou (${res.status}): ${text}`);
  }
  return res.json() as Promise<T>;
}

// Igual ao GTI, isso deveria vir de platform_channel_providers no banco.
const credsByConnection = new Map<string, MkomCredentials>();

export function registerMkomConnection(
  connectionId: string,
  creds: MkomCredentials
) {
  credsByConnection.set(connectionId, creds);
}

function credsFor(connectionId: string): MkomCredentials {
  const creds = credsByConnection.get(connectionId);
  if (!creds) {
    throw new Error(
      `Conexão MKOM ${connectionId} sem credenciais carregadas — chame registerMkomConnection().`
    );
  }
  return creds;
}

function baseMkomDriver(name: string, rcs: boolean): ChannelDriver {
  return {
    name,

    async connect() {
      // SMS/RCS via MKOM não tem conceito de "instância"/QR — é uma API stateless
      // autenticada por token de plataforma. Consideramos sempre conectado assim
      // que o provider estiver cadastrado no Superadmin.
      return { status: "conectado" };
    },

    async getStatus() {
      return "conectado";
    },

    async sendText(connectionId, params: SendTextParams) {
      const creds = credsFor(connectionId);
      const message: Record<string, unknown> = {
        msisdn: params.to,
        message: params.text,
        schedule: null,
        reference: params.replyToExternalId ?? "",
      };
      if (rcs) {
        message.rcs_type = "text";
        message.content = { text: params.text };
      }
      const data = await mkomRequest<{
        data?: { id?: number; uid?: string };
      }>(creds.token, {
        mailing: {
          identifier: rcs ? "TUUVO RCS" : "TUUVO SMS",
          cost_centre_id: creds.costCentreId,
        },
        messages: [message],
      });
      return { externalId: String(data.data?.uid ?? data.data?.id ?? "") };
    },

    // Só faz sentido para RCS (suggestions/botões nativos do canal — seção 6.5).
    // SMS não suporta botão nativo; nesse caso, o menu deveria virar texto simples.
    async sendMenu(connectionId, params: SendMenuParams) {
      if (!rcs) {
        return baseMkomDriver(name, rcs).sendText(connectionId, {
          to: params.to,
          text: `${params.text}\n\n${params.options
            .map((o, i) => `${i + 1}. ${o.label}`)
            .join("\n")}`,
        });
      }
      const creds = credsFor(connectionId);
      const suggestions = params.options.map((opt) => {
        if (opt.type === "url")
          return { type: "OPEN_URL", text: opt.label, url: opt.value };
        if (opt.type === "call")
          return { type: "DIAL_PHONE", text: opt.label, phone_number: opt.value };
        return { type: "REPLY", text: opt.label, postback_data: opt.value };
      });
      const data = await mkomRequest<{
        data?: { id?: number; uid?: string };
      }>(creds.token, {
        mailing: { identifier: "TUUVO RCS Menu", cost_centre_id: creds.costCentreId },
        messages: [
          {
            msisdn: params.to,
            message: params.text, // fallback SMS automático do broker
            rcs_type: "text",
            content: { text: params.text, suggestions },
          },
        ],
      });
      return { externalId: String(data.data?.uid ?? data.data?.id ?? "") };
    },

    normalizeInbound(payload: unknown): NormalizedMessage[] {
      // Callback de status/resposta da MKOM (URL única a nível de plataforma —
      // ver nota operacional na seção 6.4). Formato observado na documentação:
      // { internal_id, status, message, msisdn, timestamp, mailing: { id, cost_centre: {...} } }
      const body = payload as {
        internal_id?: number;
        status?: number;
        status_description?: string;
        message?: string;
        msisdn?: string;
        timestamp?: number;
        mailing?: { id?: number; cost_centre?: { id?: number } };
      };

      if (!body.msisdn) return [];

      return [
        {
          externalId: String(body.internal_id ?? ""),
          from: body.msisdn,
          type: "texto",
          content: body.message ?? "",
          raw: body,
          timestamp: body.timestamp ? new Date(body.timestamp * 1000) : new Date(),
        },
      ];
    },
  };
}

export const smsMkomDriver = baseMkomDriver("mkom_sms", false);
export const rcsMkomDriver = baseMkomDriver("mkom_rcs", true);
