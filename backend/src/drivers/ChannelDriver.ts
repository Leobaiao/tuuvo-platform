/**
 * Contrato único que todo driver de canal implementa (arquitetura v2, seção 3.1).
 *
 * Regra de ouro do projeto: o resto do sistema (rotas, painel de conversas)
 * só fala com um canal através dessa interface — nunca sabe se por trás é
 * GTI, Zernio ou webchat nativo. A ÚNICA exceção é o canal de e-mail
 * (EmailDriver.ts), que tem uma regra de formatação própria (delimitador),
 * mas mesmo assim entrega pro resto do sistema uma NormalizedMessage igual
 * a qualquer outro canal — a exceção fica contida dentro do driver.
 *
 * Pra adicionar um canal novo: implemente essa interface num arquivo novo em
 * drivers/, registre em drivers/registry.ts, e pronto — nenhum outro arquivo
 * do projeto precisa saber que esse canal existe.
 */

export type ConnectionStatus =
  | "desconectado"
  | "qr_pending"
  | "conectado"
  | "erro";

export interface NormalizedMessage {
  externalId: string;
  from: string;
  to?: string;
  type: "texto" | "midia" | "menu_resposta" | "localizacao" | "contato";
  content: string;
  anexos?: Array<{ nome: string; url: string; tipo: string; tamanho?: number }>;
  raw: unknown; // payload original do provedor, útil pra auditoria/debug
  timestamp: Date;
}

export interface SendTextParams {
  to: string;
  text: string;
  replyToExternalId?: string;
  /**
   * Categoria de cobrança (seção 14) — só relevante pra whatsapp_zernio e
   * rcs, ignorado pelos demais drivers. WhatsApp: marketing|utility|
   * authentication|service. RCS: simples|multimidia|conversation.
   */
  categoriaCobranca?: string;
}

export interface SendMenuOption {
  type: "reply" | "url" | "call";
  label: string;
  value: string;
}

export interface SendMenuParams {
  to: string;
  text: string;
  footer?: string;
  style: "button" | "list" | "carousel" | "poll";
  options: SendMenuOption[];
}

export interface ChannelDriver {
  readonly name: string;

  connect(connectionId: string, credentials: Record<string, unknown>): Promise<{
    status: ConnectionStatus;
    qrCode?: string;
    pairCode?: string;
  }>;

  getStatus(connectionId: string): Promise<ConnectionStatus>;

  sendText(connectionId: string, params: SendTextParams): Promise<{ externalId: string }>;

  /**
   * Menu interativo (botão/lista/enquete/carrossel) — OPCIONAL por design.
   * Nem todo canal suporta (e-mail não faz sentido; WhatsApp não-oficial tem
   * suporte instável, ver nota de risco em WhatsAppGtiDriver.ts).
   */
  sendMenu?(connectionId: string, params: SendMenuParams): Promise<{ externalId: string }>;

  normalizeInbound(payload: unknown): NormalizedMessage[];
}
