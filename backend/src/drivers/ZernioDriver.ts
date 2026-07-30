/**
 * Driver Zernio — cobre WhatsApp OFICIAL e redes sociais (Instagram, Telegram,
 * Facebook, X, Bluesky, Reddit) com o MESMO driver, diferenciado só pelo
 * campo `platform` na config da conexão (arquitetura v2, seção 3.3).
 *
 * Isso é o requisito explícito do usuário: "plugar canal novo da Zernio pro
 * tenant é cadastro, não código" — adicionar WhatsApp oficial ou Instagram
 * pro mesmo tenant não exige nenhuma linha de código nova, só uma nova
 * `channel_connections` com `config.platform` diferente.
 *
 * Modelo de credencial: uma API key por PLATAFORMA inteira (confirmado —
 * "uma key é suficiente pra toda a integração"), guardada em
 * `platform_channel_providers` (tipo='zernio'), não por tenant. Dentro dessa
 * key, cada tenant = 1 "profile" da Zernio (ver createZernioProfileForTenant).
 */
import {
  ChannelDriver,
  NormalizedMessage,
  SendTextParams,
} from "./ChannelDriver";

export type ZernioPlatform =
  | "whatsapp" | "instagram" | "telegram" | "facebook" | "x" | "bluesky" | "reddit";

interface ZernioConnectionConfig {
  profileId: string;   // 1 por tenant
  accountId: string;   // conta específica dentro do profile
  platform: ZernioPlatform;
}

const ZERNIO_BASE_URL = "https://zernio.com/api/v1";

async function zernioRequest<T>(path: string, token: string, init: RequestInit = {}): Promise<T> {
  const res = await fetch(`${ZERNIO_BASE_URL}${path}`, {
    ...init,
    headers: { "Content-Type": "application/json", Authorization: `Bearer ${token}`, ...(init.headers ?? {}) },
  });
  if (!res.ok) {
    const text = await res.text().catch(() => "");
    throw new Error(`Zernio API ${path} falhou (${res.status}): ${text}`);
  }
  return res.json() as Promise<T>;
}

const connByConnection = new Map<string, { token: string; config: ZernioConnectionConfig }>();

export function registerZernioConnection(
  connectionId: string, token: string, config: ZernioConnectionConfig
) {
  connByConnection.set(connectionId, { token, config });
}

function connFor(connectionId: string) {
  const conn = connByConnection.get(connectionId);
  if (!conn) throw new Error(`Conexão Zernio ${connectionId} sem credenciais carregadas.`);
  return conn;
}

/** Cria o profile da Zernio pra um tenant novo — chamar 1x por tenant, não por conexão. */
export async function createZernioProfileForTenant(
  token: string, tenantSlug: string, tenantNome: string
): Promise<{ profileId: string }> {
  const data = await zernioRequest<{ profile: { _id: string } }>("/profiles", token, {
    method: "POST",
    body: JSON.stringify({ name: tenantSlug, description: tenantNome }),
  });
  return { profileId: data.profile._id };
}

export const zernioDriver: ChannelDriver = {
  name: "zernio",

  async connect(connectionId, credentials) {
    const creds = credentials as unknown as { token: string } & ZernioConnectionConfig;
    registerZernioConnection(connectionId, creds.token, {
      profileId: creds.profileId, accountId: creds.accountId, platform: creds.platform,
    });
    // Conexão da conta em si é OAuth via redirecionamento (GET /v1/connect/{platform}),
    // fora do controle direto da nossa API — confirmação chega via webhook account.connected.
    return { status: "conectado" };
  },

  async getStatus(connectionId) {
    const { token, config } = connFor(connectionId);
    const data = await zernioRequest<{ accounts: Array<{ _id: string }> }>(
      `/accounts?profileId=${config.profileId}`, token
    );
    return data.accounts.some((a) => a._id === config.accountId) ? "conectado" : "desconectado";
  },

  async sendText(connectionId, params: SendTextParams) {
    const { token } = connFor(connectionId);
    // `to` aqui é o conversationId da Zernio — só existe após uma primeira
    // mensagem recebida via webhook (é o webhook quem cria a conversa do lado
    // deles). Envio "a frio" sem o contato ter escrito antes não é coberto ainda.
    const data = await zernioRequest<{ id?: string }>(
      `/inbox/conversations/${params.to}/messages`, token,
      { method: "POST", body: JSON.stringify({ text: params.text }) }
    );
    return { externalId: data.id ?? "" };
  },

  // Botões/quick replies — sem endpoint/payload confirmado publicamente até
  // agora. Não implementado por segurança contra "chutar" contrato de API.
  // sendMenu: pendente.

  normalizeInbound(payload: unknown): NormalizedMessage[] {
    // Payload CONFIRMADO em docs.zernio.com/multi-tenant/inbox (exemplo real):
    // { id, event: "message.received", message: {id, conversationId, direction, text, sender},
    //   account: { id, platform } }
    const body = payload as {
      id?: string;
      event?: string;
      message?: { id?: string; conversationId?: string; direction?: string; text?: string };
      account?: { id?: string; platform?: string };
    };
    if (body.event !== "message.received" || !body.message) return [];
    if (body.message.direction && body.message.direction !== "incoming") return [];
    return [{
      externalId: body.message.id ?? body.id ?? "",
      from: body.message.conversationId ?? "",
      type: "texto",
      content: body.message.text ?? "",
      raw: body,
      timestamp: new Date(),
    }];
  },
};

/** Registro do webhook de plataforma (uma vez por time, até 10 endpoints). */
export async function registerZernioWebhook(token: string, callbackUrl: string) {
  return zernioRequest("/webhooks/settings", token, {
    method: "POST",
    body: JSON.stringify({
      name: "TUUVO Conversation Platform",
      url: callbackUrl,
      events: [
        "conversation.started", "message.received", "message.sent",
        "message.delivered", "message.read", "message.failed",
        "account.connected", "account.disconnected",
      ],
      isActive: true,
    }),
  });
}
