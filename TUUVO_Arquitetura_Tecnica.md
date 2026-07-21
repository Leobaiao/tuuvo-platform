# TUUVO Conversation Platform
## Especificação de Arquitetura — Sistema Multi-Tenant de Conversação

**Todas as conversas. Um único lugar.**
Versão 1.0 · Julho/2026

---

## 1. Posicionamento no ecossistema

De acordo com o Brand Book, a TUUVO é a **camada omnichannel de conversação** que fica entre os canais do cliente e as duas plataformas verticais do grupo:

```
                         CANAIS
        Webchat · WhatsApp · E-mail · Social · APIs
                            │
                            ▼
              ┌─────────────────────────────┐
              │   TUUVO CONVERSATION PLATFORM │
              │  (roteamento, departamentos,  │
              │   histórico unificado, bots)  │
              └───────┬───────────────┬───────┘
                       │               │
                       ▼               ▼
                  NUUVO                 ALTDESK
          WhatsApp Messaging      Service Desk Platform
              Platform            (github.com/Leobaiao/altdesk)
```

A TUUVO **não substitui** o AltDesk nem a NUUVO — ela é a peça que centraliza a conversa e entrega, via SDK/sandbox, para quem for consumir (o próprio AltDesk, ou qualquer outro sistema do cliente).

Isso define o requisito mais importante do projeto: **a TUUVO tem que ser simples de configurar e fácil de embutir em outro produto**, não um segundo "console gigante" para o cliente aprender.

---

## 2. Princípios de design

1. **Um tenant, várias conexões, canais por opção.** O cliente ativa só o que usa (webchat, WhatsApp, outros via Zernio) — nada vem ligado por padrão.
2. **Departamentos vivem dentro da conexão, não da plataforma.** Uma única conexão de WhatsApp pode atender "Comercial", "Suporte", "Financeiro" com roteamento por regra, sem precisar de números/instâncias separados.
3. **Configuração > código.** Tudo que muda visualmente ou comportamentalmente no bot (cor, avatar, textos, horário) é dado, não deploy.
4. **Sandbox first.** Toda funcionalidade nova nasce testável isoladamente (link de preview + credenciais de teste) antes de ser embutida no AltDesk ou em qualquer outro host.
5. **Canais são drivers plugáveis.** WhatsApp, SMS e "outros canais" implementam a mesma interface interna — trocar de provedor (ex.: GTI → outro gateway) é config, não reescrita.

---

## 3. Arquitetura multi-tenant — visão de componentes

```
┌───────────────────────────────────────────────────────────────────┐
│                         TUUVO PLATFORM                              │
│                                                                       │
│  ┌───────────────┐   ┌──────────────────┐   ┌─────────────────┐   │
│  │  Superadmin    │   │  Painel do Tenant │   │  Widget Builder  │   │
│  │  (cadastro de  │   │  (config, users,  │   │  (bot client:    │   │
│  │  clientes,     │   │  departamentos,   │   │  cor, header,    │   │
│  │  planos,       │   │  canais, equipe)  │   │  avatar, tamanho)│   │
│  │  billing)      │   │                    │   │                  │   │
│  └───────┬────────┘   └─────────┬─────────┘   └────────┬─────────┘   │
│          │                       │                        │           │
│          └──────────────┬────────┴────────────────────────┘           │
│                          ▼                                             │
│               ┌─────────────────────┐                                 │
│               │   Core API (REST +   │                                 │
│               │   WebSocket) — auth,  │                                 │
│               │   tenants, RBAC,      │                                 │
│               │   conversas, filas    │                                 │
│               └──────────┬───────────┘                                 │
│                          │                                             │
│     ┌────────────────────┼─────────────────────┐                      │
│     ▼                    ▼                     ▼                      │
│ ┌─────────┐      ┌──────────────┐      ┌────────────────┐            │
│ │ Channel  │      │ Channel       │      │ Channel Driver: │            │
│ │ Driver:  │      │ Driver:       │      │ Zernio          │            │
│ │ Webchat  │      │ WhatsApp      │      │ (Instagram,     │            │
│ │ (nativo, │      │ (não-oficial, │      │ Telegram, FB,   │            │
│ │ WS+REST) │      │ via GTI ou    │      │ X, Discord...)  │            │
│ │          │      │ gateway       │      │ + Workflow      │            │
│ │          │      │ plugável)     │      │ Builder + MCP   │            │
│ └─────────┘      └──────────────┘      └────────────────┘            │
│                                                                       │
│               ┌─────────────────────────────┐                         │
│               │ AI Agent Gateway (Claude)     │                         │
│               │ — MCP tools + prompt/contexto │                         │
│               │   por departamento/tenant     │                         │
│               └─────────────────────────────┘                         │
│                                                                       │
│               ┌─────────────────────────────┐                         │
│               │ Embed SDK / Sandbox           │                         │
│               │ (script tag + iframe + API)   │                         │
│               │ → consumido pelo AltDesk ou   │                         │
│               │   qualquer outro sistema      │                         │
│               └─────────────────────────────┘                         │
└───────────────────────────────────────────────────────────────────┘
```

### Isolamento de tenant
- **Estratégia recomendada:** banco compartilhado com `tenant_id` em todas as tabelas + row-level security (Postgres RLS) — mais simples de operar que schema-por-tenant e escala bem até dezenas de milhares de tenants pequenos/médios (perfil de agência/atendimento).
- Se o padrão do grupo for SQL Server (como no AltDesk), o mesmo modelo se replica com `tenant_id` + políticas de segurança em nível de aplicação, já que o SQL Server não tem RLS nativo tão maduro quanto o Postgres — ver seção 13.

---

## 4. Modelo de dados essencial

```
tenants (id, nome, slug, plano, status, criado_em)
users (id, tenant_id, email, senha_hash, papel, status)  -- papel: superadmin | admin | supervisor | agente
departments (id, tenant_id, nome, horario_atendimento, regras_roteamento)
channel_connections (id, tenant_id, tipo, driver, credenciais_criptografadas, status, ativo)
    -- tipo: webchat | whatsapp | sms | rcs | voz | zernio_instagram | zernio_telegram | ...
platform_channel_providers (id, tipo, nome, endpoint_base, credenciais_criptografadas, ativo)
    -- nível PLATAFORMA (superadmin), não por tenant — usado por sms, rcs, voz
    -- as channel_connections desses tipos referenciam o provider da plataforma + config específica do tenant (ex.: remetente/sender ID)
department_channels (department_id, channel_connection_id)  -- N:N — mesma conexão, vários deptos
conversations (id, tenant_id, channel_connection_id, department_id, contato_id, status, atribuido_a)
messages (id, conversation_id, remetente_tipo, conteudo, anexos, enviado_em)
bot_widgets (id, tenant_id, nome, config_json, versao, publicado)
ai_agents (id, tenant_id, department_id, provedor, modelo, prompt_base, mcp_config, ativo)
audit_log (id, tenant_id, user_id, acao, alvo, criado_em)
```

`config_json` do widget guarda exatamente as propriedades da seção 8, versionadas — cada publicação gera snapshot, permitindo rollback.

---

## 5. Autenticação e Superadmin

- **Superadmin** (nível plataforma, fora de qualquer tenant): cadastra clientes/tenants, define plano e limites (nº de conexões, nº de agentes, canais habilitados), suspende/reativa, vê métricas agregadas de uso. Não acessa conversas dos tenants por padrão (opção de "modo suporte" com trilha de auditoria explícita, se necessário).
- **Credenciais de canal a nível de plataforma:** SMS, RCS e Voz usam brokers contratados pelo grupo (não pelo tenant individual), então as credenciais dessas APIs (endpoint, chave/token, conta) ficam cadastradas **uma vez no Superadmin** (`platform_channel_providers`, seção 4), não repetidas por cliente. Cada tenant só configura o que é específico dele em cima do provider já cadastrado (ex.: sender ID/remetente do SMS, número de RCS vinculado). Isso é diferente do WhatsApp via GTI, onde cada tenant tem seu próprio token de instância — o Superadmin, nesse caso, só precisa ver quantas instâncias existem e o status delas, sem guardar credencial nenhuma. Essa mesma tela do Superadmin fica pronta para receber Voz assim que o provedor for escolhido, sem mudança de estrutura.
- **Login:** e-mail/senha + 2FA opcional (TOTP) para admins; SSO (OIDC/SAML) como item de roadmap para contas enterprise.
- **RBAC por tenant:** Admin (configura tudo), Supervisor (gerencia fila/equipe do seu departamento), Agente (atende conversas atribuídas).
- **Tokens:** JWT de curta duração + refresh token; API keys separadas para integrações server-to-server (ex.: AltDesk consumindo a API da TUUVO).

---

## 6. Canais

### 6.1 Webchat (nativo)
- Widget embutível via `<script>` (snippet) ou iframe, WebSocket para tempo real, fallback long-polling.
- Funciona standalone (sandbox) ou embutido em qualquer site/produto, incluindo o AltDesk.

### 6.2 WhatsApp não-oficial — driver GTI (confirmado)

A collection `GTI API | v3 Botões` confirma que é uma **API multi-instância de WhatsApp não-oficial** (padrão Baileys), base `https://api.gtiapi.workers.dev`. Cada **instância = 1 número de WhatsApp conectado**, identificada por um `token` próprio (auth tipo apikey, enviado como `token` — em header nas chamadas REST normais, e como query string `?token=...` no SSE, já que `EventSource` do browser não permite headers customizados).

**Mapeamento direto para o modelo da seção 4:** 1 `channel_connection` do tipo `whatsapp` = 1 instância GTI = 1 `token`. Isso confirma a decisão da seção 7 (N departamentos por conexão) sem precisar de número extra por depto.

**Ciclo de vida da instância**
| Ação | Endpoint | Observação |
|---|---|---|
| Conectar | `POST /instance/connect` | Sem `phone` no body → retorna **QR code**; com `phone` → retorna **pair code** (parear sem escanear) |
| Status / acompanhar QR | `GET /instance/status` | Poll aqui para ver mudança de estado até conectar |
| Desconectar | `POST /instance/disconnect` | — |
| Renomear instância | `POST /instance/updateInstanceName` | Útil para o painel mostrar o nome amigável da conexão |

**Tempo real — duas opções, não mutuamente exclusivas**
- **SSE** (`GET /sse?token=...&events=messages&events=messages_update...`): ideal para o backend da TUUVO manter uma conexão persistente por instância e já emitir os eventos internamente via WebSocket para o painel/widget. Eventos disponíveis: `connection, history, messages, messages_update, call, contacts, presence, groups, labels, chats, chat_labels, blocks, leads`.
- **Webhook** (`POST /webhook` para registrar URL + eventos + filtros `excludeMessages`; `GET /webhook` para conferir a config atual): melhor para ambientes serverless/multi-instância onde manter uma SSE aberta por tenant é mais caro operacionalmente.
- **Recomendação:** usar **webhook** como canal principal de ingestão (mais barato de escalar com muitos tenants) e reservar **SSE** para o preview ao vivo no sandbox/onboarding (conectar → ver QR mudar → ver "conectado" em tempo real, sem precisar dar refresh).

**Envio de mensagens**
| Tipo | Endpoint | Observação |
|---|---|---|
| Texto | `POST /send/text` | Suporta `replyid`, `mentions`, `readchat`, `delay` |
| Mídia | `POST /send/media` | — |
| Contato / Localização | `POST /send/contact` · `POST /send/location` | — |
| Status/Stories | `POST /send/status` | texto, vídeo, imagem, áudio/ptt |
| **Menu interativo** | `POST /send/menu` | `type`: `poll`, `list`, `button` ou `carousel` — **este é o endpoint que resolve o menu de roteamento por departamento da seção 7** ("1. Comercial 2. Suporte" vira botão/lista nativo do WhatsApp, não texto simulando menu) |
| Presença (digitando) | `POST /message/presence` | — |

**Ações e gestão:** `message/find`, `message/react`, `message/delete`, `message/markread`, `message/download`; `chat/find`, `chat/labels`, `chat/pin`, `chat/mute`, `chat/archive`, `chat/read`, `chat/block`, `chat/blocklist`, `chat/delete`, `label/edit`, `labels`, `contacts`, `chat/GetNameAndImageURL`, `chat/check`; grupos e comunidades completos (`group/*`, `community/*`).

**Contrato interno do driver** (para manter a troca de provedor possível como plano B):
```
connect(instance_token, phone?) -> { qrcode? , paircode? }
getStatus(instance_token) -> connected | qr_pending | disconnected
sendText/sendMedia/sendMenu(instance_token, to, payload) -> message_id
registerWebhook(instance_token, url, events[]) -> ok
onWebhookEvent(payload) -> normalized_message   // adapta o formato GTI pro modelo interno de `messages`
```
Isso mantém a GTI como implementação default, mas sem acoplar o resto do sistema ao formato exato dela.

### 6.3 Redes sociais — Zernio (driver implementado, confirmado contra docs.zernio.com)
**Escopo restrito a redes sociais** (Instagram, Telegram, Facebook Messenger, X, Bluesky, Reddit). SMS, RCS e Voz **não passam pelo Zernio** — custo alto demais para esses volumes; esses três canais usam brokers próprios (seção 6.4, 6.5, 6.6). WhatsApp também fica fora do Zernio — já é coberto pelo driver GTI (seção 6.2).

- **Base:** `https://zernio.com/api/v1` · **Auth:** `Authorization: Bearer sk_...` — **uma única API key para toda a plataforma** (confirmado: "one API key is enough for your whole integration", rate limit escala com o total de contas conectadas do time — mesmo modelo da MKOM, credencial em `platform_channel_providers`, não por tenant).
- **Modelo de tenant dentro da Zernio:** cada tenant da TUUVO = 1 **profile** da Zernio (`POST /v1/profiles`, criado uma vez por tenant). Cada conta social conectada (Instagram, Telegram...) pertence a um profile e tem seu próprio `accountId`. Isso importa pro isolamento: sem profile, contas de tenants diferentes ficariam misturadas do lado da Zernio.
- **Conexão de conta:** OAuth (`GET /v1/connect/{platform}?profileId=...` → redireciona, autoriza, volta) — não é um fluxo que a TUUVO controla por API, é redirecionamento de navegador. A confirmação de que a conta conectou chega via webhook `account.connected`.
- **Webhook único por time** (até 10 endpoints), roteado por tenant assim:

  | Eventos | Chave de tenant no payload | Onde procurar |
  |---|---|---|
  | `post.*` | `accountId` em cada entrada de `platforms` | mapa accountId → tenant |
  | `account.connected` / `account.disconnected` | `profileId` direto | registro do tenant |
  | `message.received` e demais eventos de inbox | `account.id` (**aninhado**, não campo solto) | mapa accountId → tenant |

- **Payload real confirmado de `message.received`** (exemplo da própria doc):
  ```json
  {
    "id": "5f8e2a1c-...",
    "event": "message.received",
    "message": { "id": "665f...", "conversationId": "664a...", "direction": "incoming", "text": "...", "sender": { "name": "Jane", "username": "jane_doe" } },
    "account": { "id": "665f1c2e8b3a4d0012345678", "platform": "instagram" }
  }
  ```
- **Enviar resposta:** `POST /v1/inbox/conversations/{conversationId}/messages`. **Divergência não resolvida entre duas páginas da doc oficial:** o Quickstart geral manda `{ accountId, message }` no body; o guia específico multi-tenant manda só `{ text }`. O driver segue a versão multi-tenant (mais específica pro nosso caso), mas isso precisa ser testado contra uma conta real antes de produção.
- **Entrega é "at-least-once"** — a doc recomenda dedupe por `event.id` e responder em até 5 segundos (processar de fato numa fila/worker, mesma recomendação já vale pra MKOM). **Verificação de assinatura HMAC-SHA256** (`X-Zernio-Signature`) ainda não implementada no scaffold — ver TODO no código.
- **Não implementado ainda, por falta de endpoint confirmado:** menu/botões interativos (quick replies existem pra Meta/WhatsApp/Telegram segundo a doc, mas sem payload documentado que eu tenha encontrado) e envio "a frio" (primeira mensagem sem o contato ter escrito antes).
- Zernio também tem um **Workflow Builder visual** e servidor MCP hospedado (`mcp.zernio.com`), compatível nativamente com Claude — não detalhado tecnicamente aqui, mas é a peça que resolve "preparar para AI agent Claude" nos canais sociais sem reinventar integração.

### 6.4 SMS — broker MKOM (módulo MKSMS)
- **Base:** `https://sms.mkmservice.com/sms/api/transmission/v1` · **Auth:** `Authorization: Bearer <token>` — token gerado na "Área do Cliente" da MKOM, vinculado à credencial de quem criou, sem expiração automática (recomendação da própria MKOM: validade longa).
- **Envio (batch nativo):**
  ```json
  {
    "mailing": { "identifier": "nome do lote", "cost_centre_id": 12345 },
    "messages": [
      { "msisdn": "5511987456123", "message": "texto", "schedule": null, "reference": "id_livre" }
    ]
  }
  ```
  `schedule: null` = envio instantâneo; `cost_centre_id` mapeia bem para **departamento/centro de custo** dentro do tenant (útil pra relatório de gasto por depto na seção 4).
- **Auto-respostas nativas:** a MKOM já resolve respostas condicionais por palavra-chave (`access_level` / `access_code` → `send_message`) sem precisar de lógica própria — dá pra usar como um menu simples de departamento por SMS (mais limitado que o menu interativo do WhatsApp/RCS, já que é por keyword exata, não botão).
- **Webhooks/callbacks — atenção operacional:** a URL de callback **não é self-service**; precisa acionar o suporte da MKOM pra cadastrar. Isso significa que a TUUVO deve registrar **uma única URL de callback a nível de plataforma** (não por tenant) e redistribuir os eventos internamente com base no `mailing.id`/`cost_centre_id` do payload — reforça a arquitetura de `platform_channel_providers` já desenhada na seção 4/5.
- A própria documentação recomenda processar callbacks via fila (Redis/Kafka/RabbitMQ) em vez de tratar na mesma transação do webhook — bate exatamente com a fila de eventos de canal já prevista na seção 13.
- **Operacional:** whitelist de IPs de saída obrigatória (campo "IPs válidos para integração") e rate limit configurável ("Requisições por segundo") — o disparo em massa da TUUVO precisa respeitar esse limite ao enfileirar.

### 6.5 RCS — broker MKOM (mesmo endpoint do SMS)
- **Mesmo endpoint e auth do SMS**, diferenciado pelo campo `rcs_type` no payload (`text`, `file`, `card`, `carousel`).
- **Fallback para SMS já é nativo do broker:** cada mensagem RCS carrega um `message` de fallback — se o RCS falhar ou o destinatário não suportar, a MKOM reenvia esse texto por SMS automaticamente. O driver da TUUVO não precisa implementar lógica de fallback própria.
- **Botões (suggestions)** seguem o padrão Google RCS Business Messaging: `REPLY`, `OPEN_URL`, `DIAL_PHONE`, `SHOW_LOCATION`, `REQUEST_LOCATION`, `CREATE_CALENDAR_EVENT` — cobertura maior que o menu do WhatsApp/GTI, permitindo ações como "Ligar agora" direto pro número do departamento, ou "Agendar" um evento de calendário a partir do menu de roteamento.
- **Rich cards e carrossel** com controle de orientação (`HORIZONTAL`/`VERTICAL`), alinhamento e tamanho de mídia — mesmo payload serve tanto pra "escolha seu departamento com imagem" quanto catálogo de produto.
- **Sender ID customizado** (`rcs_sender_id`) — clientes com mais de um remetente aprovado escolhem qual usar por envio; pode mapear pra departamento ou marca dentro do mesmo tenant, se for o caso.
- **Limites a validar no Widget Builder / driver:** texto até 3.072 caracteres, texto de suggestion até 25 caracteres, `postback_data` até 2.048 caracteres, até 11 suggestions por texto/arquivo, até 4 por card.

> **MKChannels (WhatsApp oficial) — fora de escopo, por decisão explícita.** A mesma documentação da MKOM revela um segundo módulo, MKChannels (WhatsApp por template aprovado/HSM), mas ficou definido que **só entram RCS e SMS da MKOM** — o MKChannels não faz parte deste projeto. Registro aqui só para não perder o achado caso vire relevante no futuro; nenhum driver foi desenhado para ele.

### 6.6 Voz — em definição
- Provedor ainda não escolhido. A arquitetura já reserva o canal (`channel_connections.tipo = 'voz'`) e o mesmo padrão de driver plugável, para não exigir redesenho quando o provedor for definido.
- Pontos que vão precisar de decisão quando o provedor chegar: gravação de chamada (retenção/LGPD), transcrição automática (texto da ligação também vira `message` no histórico unificado?), IVR/menu de departamento por voz (equivalente ao `/send/menu` do WhatsApp), e se a fila de atendimento de voz compartilha ou não a mesma fila dos outros canais dentro do departamento.

---

## 7. Departamentos dentro da mesma conexão

- Uma `channel_connection` (ex.: 1 número de WhatsApp) pode ser vinculada a N `departments`.
- Roteamento por regra configurável no painel, sem código:
  - **Menu inicial** (ex.: "1. Comercial 2. Suporte") — resposta define o departamento.
  - **Palavra-chave / intenção** (opcionalmente resolvida pelo AI Agent).
  - **Horário de atendimento** por departamento (fora do horário → mensagem automática ou fila).
  - **Round-robin ou fila** dentro do departamento para distribuir aos agentes.

---

## 8. Bot Client — propriedades configuráveis

Todas editáveis no Widget Builder, sem deploy, com preview ao vivo no sandbox:

**Identidade visual**
- Cor primária, cor secundária, cor de fundo do balão, cor do texto (com fallback automático para as cores TUUVO: `#1A143D`, `#6A38E2`, `#8A5CF6`, `#A78BFA`, `#5E6B7A`)
- Logo/avatar do bot (upload) e avatar do agente humano
- Header: título, subtítulo, imagem de capa, mostrar/ocultar status "online"
- Ícone do botão flutuante (padrão ou upload) e posição na tela (canto inferior direito/esquerdo)

**Dimensões (presets prontos + customizado)**
- Compacto (360×520), Padrão (400×640), Amplo (440×760), Tela cheia (mobile), ou valores customizados em px/%

**Comportamento**
- Mensagem de boas-vindas, mensagem de ausência/fora de horário
- Formulário de pré-atendimento (nome, e-mail, telefone — campos configuráveis, obrigatório ou não)
- Som de notificação (on/off), badge de mensagens não lidas
- Idioma padrão e i18n de textos da interface
- Botão "powered by TUUVO" (on/off — item comercial, por plano)

**Integração**
- Domínios autorizados a embutir o widget (whitelist)
- Departamento padrão / regra de roteamento associada
- Ativar/desativar handoff automático para AI Agent antes do humano

---

## 9. Sandbox e SDK de embed (para o AltDesk e outros hosts)

- **Sandbox público por tenant:** URL própria (`sandbox.tuuvo.app.br/{tenant}`) onde o cliente testa o widget com a config atual antes de publicar — mesmo ambiente usado pelo AltDesk.
- **SDK de embed:**
  ```html
  <script src="https://cdn.tuuvo.app.br/widget.js" data-tenant="TENANT_ID" data-widget="WIDGET_ID"></script>
  ```
  ou via **API/iframe** para integração mais profunda (ex.: o AltDesk quer renderizar a conversa dentro do próprio layout, não como bolha flutuante).
- **API pública documentada** (REST + webhooks de evento: `conversation.created`, `message.received`, `conversation.assigned`) para o AltDesk consumir sem acoplamento — o AltDesk vira só mais um consumidor da TUUVO, igual a qualquer outro sistema.
- Ambiente de sandbox tem dados fictícios e credenciais de teste isoladas do tenant de produção, para não misturar métricas/billing.

---

## 10. Onboarding

O onboarding do AltDesk (`altdesk.com.br/onboarding`) segue um fluxo curto e direto — **3 a 5 minutos, 4 passos**, tema claro/escuro (toggle "lua minguante"), tagline própria "menos caos — mais atendimento". A proposta abaixo replica essa estrutura para a TUUVO, adaptando o conteúdo específico (canal de conversa em vez de "tipo de demo") e aplicando a paleta TUUVO por padrão.

| # | AltDesk (referência) | TUUVO (adaptado) |
|---|---|---|
| **Passo 1 — Criar acesso** | E-mail corporativo + senha → vira o admin inicial, acesso completo ao ambiente. Dica: "use um e-mail corporativo". | Igual: e-mail + senha cria o tenant e o usuário admin. Mesmo texto de apoio. |
| **Passo 2 — Escolher experiência** | Demonstração Completa vs. Demonstração Pesada (volume de dados) — mas ambas liberam todos os recursos. | **Escolha de canais** (webchat / WhatsApp / outros via Zernio) em vez de tipo de demo — o cliente marca o que vai usar; nada fica ativo por padrão (princípio da seção 2). Todos os recursos do plano ficam disponíveis independente da escolha, igual ao texto "Importante" do AltDesk. |
| **Passo 3 — Criar ambiente** | Botão único "Criar Ambiente" → provisiona empresa, usuário admin, estrutura inicial, config padrão, ambiente de avaliação. Pode voltar e ajustar antes de criar. | Mesmo botão único ("Criar Ambiente"), provisionando: tenant, usuário admin, **departamento padrão** (ex.: "Atendimento Geral"), **conexão do(s) canal(is) escolhido(s)** já pronta pra parear (QR code do WhatsApp, ou snippet do webchat), trial de 15 dias. |
| **Passo 4 — Ambiente criado** | Tela de "Parabéns, seu ambiente está pronto", operação já funcional. | Igual, com o widget já visível no sandbox com as cores TUUVO padrão, pronto pra personalizar. |

Depois do passo 4, o AltDesk fecha com dois blocos que valem replicar tal e qual:
- **"O que você já tem"** — checklist do que foi provisionado (ambiente ativo, admin, estrutura inicial, dashboard, trial habilitado, acesso completo).
- **"O que fazer agora"** — 5 próximos passos sugeridos, numerados: no caso da TUUVO seriam *Conheça o painel → Conecte seu primeiro canal (parear WhatsApp / publicar snippet do webchat) → Configure o widget (cor, avatar, mensagens) → Convide sua equipe → Explore os indicadores*.

Esse espelhamento não é só estético: como a TUUVO vai ser **consumida pelo AltDesk** (seção 9), faz sentido que quem já passou pelo onboarding do AltDesk reconheça o mesmo ritmo ao conectar a TUUVO — reduz fricção de adoção pra quem já é cliente do grupo.

---

## 11. Preparação para AI Agent (Claude)

- **Camada de agente por departamento/tenant:** cada `ai_agents` guarda prompt-base, contexto (FAQ, políticas), e pode operar em dois modos:
  - **Primeira linha:** responde automaticamente e faz handoff para humano por regra (intenção não resolvida, pedido explícito, ou horário).
  - **Copiloto do agente:** sugere resposta, não envia sozinho.
- **Integração técnica:** via API do Claude (Messages API) para geração de resposta, e via **MCP** para ações (consultar pedido, abrir ticket no AltDesk, etc.) — o MCP hospedado do Zernio já cobre ações nos canais sociais; para WhatsApp/webchat a TUUVO expõe seu próprio servidor MCP interno com ferramentas de conversa (`get_conversation_history`, `assign_department`, `close_conversation`).
- Isso deixa a porta aberta tanto para "Claude responde no chat" quanto para "Claude opera a plataforma via agente" sem redesenho.

---

## 12. Aplicação da marca

Já recebi o kit completo (`TUUVO_Identidade_Visual_Completa.zip`) com logos em SVG/PNG (positivo, negativo, monocromático), favicons, ícones de app, templates sociais e o Brand Book. Paleta e tipografia (Inter) devem ser os **defaults** do Widget Builder e do painel administrativo, com a opção de o tenant sobrescrever cores no próprio widget (branding do cliente final), mantendo a marca TUUVO só na interface administrativa e no rodapé opcional do widget.

---

## 13. Stack técnica

Como o padrão do AltDesk já é **TypeScript (backend + frontend) + Docker Compose**, recomendo manter o mesmo stack de linguagem/deploy para a TUUVO por três motivos: reaproveitamento de equipe, deploy já testado (o `docker-compose up --build` do AltDesk é reaproveitável como referência), e integração mais simples entre os dois sistemas (mesmos tipos compartilhados, como já existe em `shared/types` no repo do AltDesk).

**Banco de dados: Postgres (confirmado).** Vale notar que isso difere do que encontrei no README do repositório `Leobaiao/altdesk`, que menciona SQL Server explicitamente (porta `1433`/`14333` do Docker) e tem `TSQL 6.8%` no breakdown de linguagens — ou seja, o AltDesk hoje roda em SQL Server, e a TUUVO nasce em Postgres, num banco separado. Os dois sistemas continuam interoperando normalmente via API (seção 9); a diferença de banco não trava a integração TUUVO ↔ AltDesk, só significa que não há compartilhamento direto de schema entre eles.

Vantagens diretas de Postgres pra esse caso: **Row-Level Security nativo** (isolamento de tenant garantido no próprio banco, não só na camada de aplicação — a proteção que mais reduz risco de vazamento entre tenants num sistema que guarda conversas de clientes diferentes no mesmo banco), full-text search maduro (útil pra busca de histórico de conversas), e é o padrão de facto pra SaaS multi-tenant novo.

Sugestão de composição:
- **Backend:** Node.js/TypeScript (NestJS ou Express), WebSocket (Socket.IO) para tempo real
- **Banco:** Postgres, com `tenant_id` em todas as tabelas + políticas de RLS por tenant
- **Frontend:** React/TypeScript para painel e Widget Builder; widget de embed em vanilla JS/TS compilado para bundle leve (não pode carregar um framework inteiro no site do cliente)
- **Filas/eventos:** Redis (pub/sub para tempo real entre instâncias) + fila para webhooks de canais
- **Deploy:** Docker Compose (dev) → Docker + orquestrador (produção), mesmo padrão do AltDesk

---

## 14. Roadmap por fases

**Fase 1 — Fundação**
Superadmin + cadastro de tenant, auth/RBAC, webchat nativo, 1 departamento, sandbox básico.

**Fase 2 — WhatsApp + Departamentos**
Driver WhatsApp (GTI ou fallback), múltiplos departamentos por conexão, roteamento por regra.

**Fase 3 — Widget Builder completo**
Todas as propriedades da seção 8, presets de dimensão, publicação versionada.

**Fase 4 — Embed SDK + integração AltDesk**
API pública + webhooks, SDK de embed, piloto real integrado ao AltDesk.

**Fase 5 — Zernio + AI Agent**
Canais adicionais via Zernio, Workflow Builder, agente Claude (primeira linha ou copiloto).

**Fase 6 — Onboarding self-serve**
Fluxo completo de onboarding, billing por plano, métricas do superadmin.

---

## 15. Decisões — status

1. ~~**WhatsApp/GTI**~~ — **Resolvido.** Collection confirmada: API multi-instância de WhatsApp não-oficial (`api.gtiapi.workers.dev`), com QR/pareamento, SSE, webhook e menus interativos nativos — detalhada na seção 6.2.
2. ~~**Onboarding do AltDesk**~~ — **Resolvido.** Fluxo de 4 passos extraído da apresentação oficial, adaptado na seção 10.
3. ~~**Repositório `Leobaiao/altchat`**~~ — **Resolvido: descontinuado.** Por decisão do time, esse repositório será desativado. A arquitetura desta especificação foi desenhada do zero e não depende dele em nenhum ponto.
4. ~~**Banco de dados**~~ — **Resolvido: Postgres**, com RLS nativo por tenant (seção 13). Nota: difere do SQL Server usado hoje no AltDesk — os sistemas seguem interoperando via API, sem schema compartilhado.
5. ~~**SMS e RCS**~~ — **Resolvido.** Broker MKOM (módulo MKSMS), detalhado na seção 6.4/6.5: mesmo endpoint pra SMS e RCS, fallback nativo, auth Bearer, callback centralizado a nível de plataforma.
6. **Voz:** provedor ainda em escolha — seção 6.6 já reserva o canal e lista os pontos que vão precisar de decisão (gravação/LGPD, transcrição, IVR, fila compartilhada) assim que o provedor for definido.
7. ~~**MKChannels (WhatsApp oficial)**~~ — **Resolvido: fora de escopo.** Só RCS e SMS da MKOM entram; MKChannels fica registrado apenas como achado, sem driver desenhado.
