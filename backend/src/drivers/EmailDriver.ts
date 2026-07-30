/**
 * Driver de e-mail — a ÚNICA exceção à "transparência de canal" do resto do
 * sistema (arquitetura v2, seção 3.7). Todo outro canal fala free text puro;
 * e-mail precisa de um delimitador porque cliente de e-mail sempre cola o
 * histórico/assinatura/citação abaixo da resposta nova, e sem marcador isso
 * tudo viraria "conteúdo da conversa" por engano.
 *
 * Mecânica:
 *  1. Toda mensagem ENVIADA pelo agente sai com um cabeçalho fixo instruindo
 *     o destinatário a escrever a resposta ACIMA do delimitador.
 *  2. Quando o destinatário responde, o cliente de e-mail dele cola a
 *     resposta nova ACIMA da mensagem original citada (comportamento padrão
 *     de reply) — e a mensagem original citada já contém o delimitador que
 *     nós mesmos plantamos. Ou seja: tudo ANTES da primeira ocorrência do
 *     delimitador, no e-mail recebido, é a resposta nova de verdade.
 *
 * ⚠️ ACHADO — inconsistência no documento de definição original do usuário:
 * o delimitador aparece com 7 sinais de "+" numa frase e 6 noutra. Em vez de
 * adivinhar qual é o "certo", o parser abaixo aceita qualquer sequência de
 * 5 ou mais "+" seguidos — resiliente à variação, mas ainda assim recomendo
 * padronizar o texto oficial usado no `montarCabecalhoEnvio()` abaixo pra
 * um valor único, current: 6 sinais (`++++++`).
 *
 * O que este driver NÃO resolve sozinho (infraestrutura real de e-mail,
 * fora do escopo de lógica pura): envio de verdade via SMTP e leitura via
 * IMAP precisam de uma biblioteca (ex.: nodemailer pra enviar, imapflow +
 * mailparser pra ler) configurada com uma caixa real — os métodos abaixo
 * têm TODO explícito nesses dois pontos. A lógica de delimitador em si
 * (a parte nova/arriscada de acertar) é 100% implementada e testável sem
 * precisar de caixa de e-mail real — é só manipulação de string.
 */
import { ChannelDriver, NormalizedMessage, SendTextParams } from "./ChannelDriver";

const DELIMITADOR_PADRAO = "++++++";
// Usado só pra detectar a linha de INSTRUÇÃO (pra removê-la se sobrar sem
// querer no meio da resposta nova, ver cenário 2 do teste).
const CABECALHO_INSTRUCAO =
  "Escreva sua mensagem a partir daqui até a marca " + DELIMITADOR_PADRAO;

/**
 * Monta o corpo do e-mail de saída — cabeçalho de instrução, mensagem do
 * agente, delimitador. É essa combinação que, quando citada de volta pelo
 * cliente de e-mail do destinatário, permite ao `normalizeInbound` separar
 * resposta nova de histórico antigo.
 */
export function montarCorpoEnvio(mensagemDoAgente: string): string {
  return `${CABECALHO_INSTRUCAO}\n\n${mensagemDoAgente}\n\n${DELIMITADOR_PADRAO}`;
}

/**
 * Extrai só a resposta nova de um e-mail recebido.
 *
 * Testado contra 7 cenários reais antes de considerar pronto (ver commit/
 * histórico do projeto): resposta simples, resposta sem apagar a instrução,
 * variação de 6 vs. 7 sinais de "+" (inconsistência do doc original),
 * ausência total de delimitador, citação em 2º nível ('>>'), cliente em
 * inglês ("On ... wrote:"), e resposta multi-parágrafo (garantindo que
 * quebra de linha legítima dentro da resposta nova não é destruída).
 *
 * Lógica: corta no PRIMEIRO ponto de corte encontrado, seja ele (a) uma
 * linha que é só o delimitador — tolerando prefixo de citação tipo "> " ou
 * ">> " — ou (b) uma linha de cabeçalho de citação que o próprio cliente de
 * e-mail insere automaticamente ("Em ... escreveu:" / "On ... wrote:").
 * O que vier primeiro no texto marca onde começa o "histórico antigo".
 */
export function extrairRespostaNova(corpoRecebido: string): string {
  const linhas = corpoRecebido.split("\n");
  const linhaDelimitador = /^[>\s]*\+{5,20}[>\s]*$/;
  const linhaCabecalhoCitacao = /^(em .+ escreveu:|on .+ wrote:)\s*$/i;

  let corteIndex = linhas.length; // sem marcador nenhum -> mantém tudo
  for (let i = 0; i < linhas.length; i++) {
    if (linhaDelimitador.test(linhas[i]) || linhaCabecalhoCitacao.test(linhas[i].trim())) {
      corteIndex = i;
      break;
    }
  }

  return linhas
    .slice(0, corteIndex)
    .filter((linha) => !linha.includes("Escreva sua mensagem"))
    .join("\n")
    .trim();
}

interface EmailConnectionConfig {
  imapHost: string;
  smtpHost: string;
  enderecoRemetente: string;
}

const configByConnection = new Map<string, EmailConnectionConfig>();

export function registerEmailConnection(connectionId: string, config: EmailConnectionConfig) {
  configByConnection.set(connectionId, config);
}

export const emailDriver: ChannelDriver = {
  name: "email",

  async connect(connectionId, credentials) {
    registerEmailConnection(connectionId, credentials as unknown as EmailConnectionConfig);
    // TODO produção: validar credenciais IMAP/SMTP de verdade (tentar login)
    // antes de devolver "conectado" — hoje aceita sem checar.
    return { status: "conectado" };
  },

  async getStatus() {
    // TODO produção: checar conexão IMAP ativa de verdade.
    return "conectado";
  },

  async sendText(connectionId, params: SendTextParams) {
    const corpo = montarCorpoEnvio(params.text);
    // TODO produção: enviar de verdade via SMTP (ex.: nodemailer), usando
    // configByConnection.get(connectionId) — aqui só monta o corpo final,
    // que é a parte de lógica nova/arriscada deste driver.
    void corpo; // referência só pra deixar claro que "corpo" seria usado no send() real
    throw new Error(
      "EmailDriver.sendText: envio SMTP real não implementado neste scaffold — " +
        "ver TODO no cabeçalho do arquivo."
    );
  },

  // Menu interativo não faz sentido em e-mail — não implementado por design,
  // não por esquecimento.

  normalizeInbound(payload: unknown): NormalizedMessage[] {
    // Formato esperado do payload: já vem de um listener IMAP/webhook de
    // provedor de e-mail (ex.: SendGrid Inbound Parse, Mailgun Routes) —
    // estrutura exata depende de qual for escolhido em produção. Aqui
    // assume um formato mínimo genérico só pra deixar a interface clara.
    const body = payload as {
      messageId?: string;
      from?: string;
      to?: string;
      bodyText?: string;
      timestamp?: string;
    };
    if (!body.bodyText || !body.from) return [];

    const respostaLimpa = extrairRespostaNova(body.bodyText);

    return [{
      externalId: body.messageId ?? "",
      from: body.from,
      to: body.to,
      type: "texto",
      content: respostaLimpa,
      raw: payload,
      timestamp: body.timestamp ? new Date(body.timestamp) : new Date(),
    }];
  },
};
