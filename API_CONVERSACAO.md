# TUUVO — API de Conversação (Agente ↔ Anônimo)

> Documenta o que já está implementado em código — não é proposta, é
> referência do que existe. Complementa `TUUVO_Arquitetura_v2.md` (que
> explica o *porquê*); este documento é sobre o *como*, com request/response
> reais. Peça que motivou este documento: existia código funcional pra essa
> API, mas nenhuma referência consolidada — e revisando pra escrevê-la,
> achamos e corrigimos um bug real de isolamento entre visitantes (seção 4).

---

## 1. Dois lados, dois mecanismos diferentes

```
┌─────────────────────┐                      ┌──────────────────────┐
│   VISITANTE ANÔNIMO   │                      │   AGENTE (painel)      │
│   (webchat widget)     │                      │   admin-tenant/         │
│                        │                      │                        │
│  Socket.IO             │◄──── tempo real ────►│  REST + Socket.IO      │
│  (sem REST, sem login) │                      │  (autenticado)          │
└─────────────────────┘                      └──────────────────────┘
```

- **Visitante**: só existe pra canal **webchat nativo**. Fala só por
  Socket.IO, nunca por REST, nunca autenticado. Outros canais (WhatsApp,
  RCS, e-mail) não têm "visitante conectado" — a mensagem chega via
  webhook do provedor externo (seção 5).
- **Agente**: fala por REST (ações: listar, responder, transferir, nota
  interna, fechar, exportar) + Socket.IO (só para *receber* eventos em
  tempo real, nunca para enviar mensagem — enviar é sempre REST).

---

## 2. Lado do visitante — Socket.IO puro

### 2.1 Conectar

```js
const socket = io("https://SEU-BACKEND", {
  auth: { tenantId: "...", widgetId: "...", visitorId: "..." }
});
```

Os 3 campos são **obrigatórios** — sem qualquer um deles, o servidor
desconecta a sessão imediatamente (`socket.disconnect(true)`).

`visitorId` **precisa ser estável** entre reconexões da mesma pessoa (ex.:
gerado uma vez e salvo em `localStorage`) — é o que identifica a sala de
tempo real daquele visitante especificamente. O `tuuvo-widget.js` já faz
isso (`widget/tuuvo-widget.js`, chave `tuuvo_visitor_id`).

### 2.2 Enviar mensagem

```js
socket.emit("webchat:message", { text: "Olá, preciso de ajuda" });
```

Sem confirmação de entrega síncrona — a mensagem é processada
assincronamente (grava no banco, associa/cria conversa, notifica agentes).
Não existe callback/ack neste evento.

### 2.3 Receber resposta do agente

```js
socket.on("message:new", (payload) => {
  // payload.conversationId: string (uuid)
  // payload.message: { id, remetente_tipo: "agente", conteudo, enviado_em, ... }
});
```

**Isolamento (corrigido nesta revisão)**: o visitante só recebe eventos da
**própria** conversa — nunca vê mensagem de outro visitante do mesmo
tenant, mesmo que várias conversas estejam rolando ao mesmo tempo no
mesmo widget. Antes desta correção, isso não era garantido (bug real,
não hipotético — ver commit/histórico do projeto).

Notas internas (`visivel_pro_solicitante: false`) **nunca** chegam pro
visitante — filtradas no momento da emissão (`conversations.routes.ts`).

---

## 3. Lado do agente — REST (autenticado)

Toda rota abaixo exige `Authorization: Bearer <token>` — token de sessão
(login humano) **ou** API key (`X-API-Key`, seção 13.2 da arquitetura),
via `requireTenantAuthOrApiKey`.

### `GET /conversations?status=aberta`

Lista conversas do tenant, filtradas por status.

| Query param | Valores | Padrão |
|---|---|---|
| `status` | `aberta` \| `em_atendimento` \| `fechada` | `aberta` |

**Resposta** — array de conversas, cada uma já com `contato`, `contato_nome`,
`contato_tipo`, `equipe`, `canal`, `canal_nome`, `atribuido_nome` e
`ultima_mensagem` (só mensagens visíveis, nunca nota interna) resolvidos
via JOIN — o frontend não precisa de chamada extra pra montar a lista.

### `GET /conversations/:id/messages?incluirNotas=true`

Thread completa de uma conversa.

| Query param | Valores | Padrão |
|---|---|---|
| `incluirNotas` | `true` \| `false` | `false` (só mensagens visíveis ao solicitante) |

### `POST /conversations/:id/reply`

Responde a conversa — envia pro canal externo (se não for webchat) **e**
grava no histórico **e** notifica em tempo real (agentes sempre; o
visitante específico também, se o canal for webchat).

```json
// Request
{ "texto": "Claro, posso te ajudar com isso!" }

// Response 201
{ "id": "...", "conversation_id": "...", "remetente_tipo": "agente",
  "conteudo": "Claro, posso te ajudar com isso!", "categoria_cobranca": "service", ... }
```

`categoria_cobranca` é preenchida automaticamente (seção 14 da
arquitetura) — `service` pra WhatsApp oficial, `simples` pra RCS, `null`
pros demais canais. Não é parâmetro de entrada, é derivado do canal.

### `POST /conversations/:id/nota-interna`

```json
// Request
{ "texto": "Cliente já comprou antes, aplicar desconto padrão" }
// Response 201
{ "ok": true }
```

Nunca sai pro canal externo. Aparece na thread só pra quem está no painel
(`GET .../messages?incluirNotas=true`), nunca pro visitante.

### `POST /conversations/:id/transferir`

```json
// Request — muda equipe, agente, ou os dois (o que vier null, mantém)
{ "paraEquipeId": "uuid-ou-null", "paraAgenteId": "uuid-ou-null" }
// Response 200
{ "ok": true }
```

Emite `conversation:updated` pra sala geral do tenant — todo agente
conectado percebe a mudança de fila em tempo real.

### `PATCH /conversations/:id/close`

Sem corpo. Marca `status = 'fechada'`, `fechada_em = now()`. Emite
`conversation:updated`.

### `GET /conversations/:id/export?incluirNotas=false`

Devolve `.txt` (`Content-Disposition: attachment`) com a thread formatada
— `[data/hora] remetente: conteúdo`, com `[NOTA INTERNA]` marcado se
`incluirNotas=true`.

---

## 4. Eventos Socket.IO — referência rápida

| Evento | Quem emite | Quem recebe | Payload |
|---|---|---|---|
| `webchat:message` | Visitante | Backend | `{ text: string }` |
| `message:new` | Backend | Agentes (sala do tenant) + visitante daquela conversa (sala própria) | `{ conversationId, message }` |
| `conversation:updated` | Backend | Agentes (sala do tenant) | Linha completa de `conversations` |

**Visitante nunca recebe `conversation:updated`** — esse evento é só pra
gerenciamento de fila entre agentes (transferência, fechamento), sem
utilidade nem exposição de dado pro lado do visitante.

---

## 5. E os outros canais (WhatsApp, RCS, e-mail)?

Não têm "visitante conectado" — o remetente externo não fala com o TUUVO
diretamente, fala com o provedor (GTI/Zernio/MKOM/servidor de e-mail), que
notifica o TUUVO via **webhook**:

| Canal | Endpoint de entrada |
|---|---|
| WhatsApp não-oficial | `POST /webhooks/gti/:connectionId` |
| WhatsApp oficial / redes sociais | `POST /webhooks/zernio` |
| RCS | `POST /webhooks/mkom` |
| E-mail | `POST /webhooks/email` |

Esses endpoints não fazem parte desta doc (são provedor→TUUVO, não
agente↔anônimo) — ver `backend/src/routes/webhooks.routes.ts` e seção 3 da
arquitetura pra detalhe de cada um. A resposta do agente pra esses canais
usa a **mesma** `POST /conversations/:id/reply` desta doc — só muda o que
acontece por baixo (`driver.sendText(...)` chama a API do provedor certo).
