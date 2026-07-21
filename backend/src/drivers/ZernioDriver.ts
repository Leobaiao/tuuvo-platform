import {
  ChannelDriver,
  NormalizedMessage,
  SendMenuParams,
  SendTextParams,
} from "./ChannelDriver";

/**
 * Driver de redes sociais via Zernio — Instagram, Telegram, Facebook Messenger,
 * X, Bluesky, Reddit (WhatsApp via Zernio fica de fora por decisão de custo,
 * ver seção 6.3 da especificação: WhatsApp já é coberto pelo driver GTI).
 *
 * Base: https://zernio.com/api/v1 · Auth: `Authorization: Bearer sk_...`
 * Confirmado em docs.zernio.com (Quickstart + guia "Build a Platform" /
 * multi-tenant + "Tenant Inbox & DMs") — versão anterior deste driver era
 * baseada só em marketing pages; esta foi revisada contra a doc técnica real.
 *
 * MODELO DE TENANT (confirmado, mudou em relação à v1 deste driver):
 * - **Uma API key por PLATAFORMA inteira** (não por tenant) — a própria doc
 *   diz "One API key is enough for your whole integration", com rate limit
 *   que escala pelo total de contas conectadas do time todo. Isso confirma o
 *   modelo original (igual à MKOM): token único em `platform_channel_providers`.
 * - Mas dentro dessa key, **cada tenant da TUUVO = 1 "profile" da Zernio**
 *   (`POST /v1/profiles`, um por tenant, nome único). Isso é novo — a v1 deste
 *   driver não criava profile nenhum, só guardava accountId solto. Sem
 *   profile, não dá pra isolar corretamente as contas de tenants diferentes.
 * - Cada conta social conectada (Instagram, Telegram, etc.) pertence a um
 *   profile e tem seu próprio `accountId`.
 */

interface ZernioConnectionConfig {
  profileId: string; // 1 por tenant
  accountId: string; // conta social específica dentro do profile
  platform: "instagram" | "telegram" | "facebook" | "x" | "bluesky" | "reddit";
}

const ZERNIO_BASE_URL = "https://zernio.com/api/v1";

async function zernioRequest<T>(
  path: string,
  token: string,
  init: RequestInit = {}
): Promise<T> {
  const res = await fetch(`${ZERNIO_BASE_URL}${path}`, {
    ...init,
    headers: {
      "Content-Type": "application/json",
      Authorization: `Bearer ${token}`,
      ...(init.headers ?? {}),
    },
  });
  if (!res.ok) {
    const text = await res.text().catch(() => "");
    throw new Error(`Zernio API ${path} falhou (${res.status}): ${text}`);
  }
  return res.json() as Promise<T>;
}

// Mesmo padrão dos outros drivers: credenciais deveriam vir de
// platform_channel_providers no banco (tipo = 'zernio'), aqui simplificado
// para o scaffold via registro em memória.
const connByConnection = new Map<
  string,
  { token: string; config: ZernioConnectionConfig }
>();

export function registerZernioConnection(
  connectionId: string,
  token: string,
  config: ZernioConnectionConfig
) {
  connByConnection.set(connectionId, { token, config });
}

function connFor(connectionId: string) {
  const conn = connByConnection.get(connectionId);
  if (!conn) {
    throw new Error(
      `Conexão Zernio ${connectionId} sem credenciais carregadas — chame registerZernioConnection().`
    );
  }
  return conn;
}

/** Cria o profile da Zernio para um tenant novo — chamar 1x por tenant, não por conexão. */
export async function createZernioProfileForTenant(
  token: string,
  tenantSlug: string,
  tenantNome: string
): Promise<{ profileId: string }> {
  const data = await zernioRequest<{ profile: { _id: string } }>(
    "/profiles",
    token,
    {
      method: "POST",
      body: JSON.stringify({ name: tenantSlug, description: tenantNome }),
    }
  );
  return { profileId: data.profile._id };
}

export const zernioDriver: ChannelDriver = {
  name: "zernio",

  async connect(connectionId, credentials) {
    // A conexão da conta social em si (OAuth) acontece fora da nossa API —
    // o admin do tenant clica em "conectar Instagram" e é redirecionado pra
    // `GET /v1/connect/{platform}?profileId=...`, autoriza, e a Zernio
    // devolve o accountId via webhook `account.connected`. O que fazemos
    // aqui é só registrar a config já resolvida (profileId + accountId).
    const creds = credentials as unknown as { token: string } & ZernioConnectionConfig;
    registerZernioConnection(connectionId, creds.token, {
      profileId: creds.profileId,
      accountId: creds.accountId,
      platform: creds.platform,
    });
    return { status: "conectado" };
  },

  async getStatus(connectionId) {
    const { token, config } = connFor(connectionId);
    // Confirmado: GET /v1/accounts?profileId=... lista as contas do tenant.
    // Também existe GET /v1/accounts/health pra detectar token morto — vale
    // usar isso em produção pro "reconnect loop" que a doc recomenda.
    const data = await zernioRequest<{ accounts: Array<{ _id: string }> }>(
      `/accounts?profileId=${config.profileId}`,
      token
    );
    const found = data.accounts.some((a) => a._id === config.accountId);
    return found ? "conectado" : "desconectado";
  },

  async sendText(connectionId, params: SendTextParams) {
    const { token } = connFor(connectionId);
    // `params.to` é o conversationId da Zernio — só existe depois de uma
    // primeira mensagem recebida via webhook (é o webhook quem cria a
    // conversa do lado da Zernio). Enviar "a frio" sem o contato ter escrito
    // antes não está coberto por este driver ainda.
    //
    // ATENÇÃO — divergência real entre duas páginas da doc oficial, não
    // resolvida ainda: o Quickstart geral manda `{ accountId, message }`
    // no body; o guia "Tenant Inbox & DMs" (mais específico pro nosso caso
    // multi-tenant) manda só `{ text }`. Sigo a versão do guia multi-tenant
    // por ser o cenário mais próximo do nosso, mas isso precisa ser testado
    // contra uma conta real antes de produção — se der erro de campo
    // obrigatório ausente, tentar a variante com `message` + `accountId`.
    const data = await zernioRequest<{ id?: string }>(
      `/inbox/conversations/${params.to}/messages`,
      token,
      {
        method: "POST",
        body: JSON.stringify({ text: params.text }),
      }
    );
    return { externalId: data.id ?? "" };
  },

  // Botões/quick replies — ainda sem endpoint/payload confirmado na doc
  // consultada. Não implementado por segurança contra "chutar" um contrato
  // de API errado. sendMenu: não implementado (fica pendente).

  normalizeInbound(payload: unknown): NormalizedMessage[] {
    // Formato CONFIRMADO em docs.zernio.com/multi-tenant/inbox (exemplo real
    // da própria doc, não mais extrapolação):
    // {
    //   "id": "...", "event": "message.received",
    //   "message": { "id", "conversationId", "direction", "text", "sender": {...} },
    //   "account": { "id", "platform" }
    // }
    const body = payload as {
      id?: string;
      event?: string;
      message?: {
        id?: string;
        conversationId?: string;
        direction?: string;
        text?: string;
        sender?: { name?: string; username?: string };
      };
      account?: { id?: string; platform?: string };
    };

    if (body.event !== "message.received" || !body.message) return [];
    if (body.message.direction && body.message.direction !== "incoming") return [];

    return [
      {
        externalId: body.message.id ?? body.id ?? "",
        // usamos conversationId como identificador do "contato" — é o que
        // sendText precisa pra responder (ver nota acima)
        from: body.message.conversationId ?? "",
        type: "texto",
        content: body.message.text ?? "",
        raw: body,
        timestamp: new Date(), // evento não traz timestamp explícito no exemplo da doc
      },
    ];
  },
};

/**
 * Registro do webhook de plataforma na Zernio (uma vez por time, até 10
 * endpoints — não por tenant, mesmo padrão operacional da MKOM, seção 6.4).
 * Chamar isso na configuração inicial do provider no Superadmin.
 */
export async function registerZernioWebhook(token: string, callbackUrl: string) {
  return zernioRequest(`/webhooks/settings`, token, {
    method: "POST",
    body: JSON.stringify({
      name: "TUUVO Conversation Platform",
      url: callbackUrl,
      events: [
        "conversation.started",
        "message.received",
        "message.sent",
        "message.delivered",
        "message.read",
        "message.failed",
        "account.connected",
        "account.disconnected",
      ],
      isActive: true,
    }),
  });
}
