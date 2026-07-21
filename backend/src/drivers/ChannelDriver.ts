/**
 * Contrato único que todo driver de canal implementa (seção 6 da especificação).
 * Trocar de provedor (ex.: GTI -> outro gateway de WhatsApp) é escrever um novo
 * driver que satisfaça esta interface — nada mais no sistema precisa mudar.
 */

export type ConnectionStatus =
  | "desconectado"
  | "qr_pending"
  | "conectado"
  | "erro";

export interface NormalizedMessage {
  externalId: string;
  from: string; // identificador do contato no canal (telefone, chat id, etc.)
  to?: string;
  type: "texto" | "midia" | "menu_resposta" | "localizacao" | "contato";
  content: string;
  raw: unknown; // payload original do provedor, para debug/auditoria
  timestamp: Date;
}

export interface SendTextParams {
  to: string;
  text: string;
  replyToExternalId?: string;
}

export interface SendMenuOption {
  type: "reply" | "url" | "call";
  label: string;
  value: string; // texto pra reply, url pra url, número pra call
}

export interface SendMenuParams {
  to: string;
  text: string;
  footer?: string;
  style: "button" | "list" | "carousel" | "poll";
  options: SendMenuOption[];
}

export interface ChannelDriver {
  /** Nome do driver, usado em channel_connections.driver */
  readonly name: string;

  /** Inicia conexão da instância (ex.: gera QR code do WhatsApp). */
  connect(connectionId: string, credentials: Record<string, unknown>): Promise<{
    status: ConnectionStatus;
    qrCode?: string;
    pairCode?: string;
  }>;

  /** Consulta status atual da conexão. */
  getStatus(connectionId: string): Promise<ConnectionStatus>;

  /** Envia mensagem de texto simples. */
  sendText(connectionId: string, params: SendTextParams): Promise<{ externalId: string }>;

  /** Envia menu interativo (usado no roteamento por departamento — seção 7). */
  sendMenu?(connectionId: string, params: SendMenuParams): Promise<{ externalId: string }>;

  /** Normaliza o payload recebido via webhook do provedor para o formato interno. */
  normalizeInbound(payload: unknown): NormalizedMessage[];
}
