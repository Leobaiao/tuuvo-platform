# TUUVO — Especificação de Arquitetura v2
## Reconstrução completa a partir da redefinição do projeto

**Todas as conversas. Um único lugar.**
Versão 2.0 — substitui a v1 (`TUUVO_Arquitetura_Tecnica.md`) nos pontos em que conflitar.
Os dados técnicos já validados na v1 (endpoints reais de GTI, MKOM, Zernio) continuam
valendo e são referenciados aqui, não repesquisados.

---

## 1. Dois produtos, uma base de código

O projeto é **duas aplicações com público e objetivo diferentes**, não uma só com
permissões distintas:

```
┌─────────────────────────────┐        ┌─────────────────────────────┐
│   ADMINISTRAÇÃO TUUVO         │        │   ADMINISTRAÇÃO DO TENANT     │
│   (uso interno do time TUUVO) │        │   (uso de cada cliente)        │
│                                │        │                                │
│  • Login/senha do time TUUVO,  │        │  • Login/senha, esqueci senha  │
│    com superadmin (acesso      │        │  • Usuários, equipes, permissão│
│    total) e papéis limitados   │        │  • Canais (config + deploy)    │
│  • Cadastro de tenant          │        │  • Conversas multi-canal       │
│  • Config padrão de webchat    │        │  • Transferência / nota interna│
│  • Onboarding → canal escolhido│        │  • Anexos, exportar conversa   │
│  • Adiar avaliação do cliente  │        │                                │
│  • Planos de preço (CRUD) +     │        │                                │
│    embed público (JS) pro site │        │                                │
│  • Dashboard: tenants, churn,  │        │                                │
│    faturamento, consultoria    │        │                                │
│  • Consumo por cliente (RCS/   │        │                                │
│    WhatsApp oficial cobráveis) │        │                                │
└─────────────────────────────┘        └─────────────────────────────┘
```

Ambas rodam sobre a **mesma API e o mesmo banco** (multi-tenant com RLS, como na v1),
mas são **dois frontends separados** (`admin-tuuvo/` e `admin-tenant/`), cada um só
com as telas que faz sentido pro seu público — evita o erro da v1 de misturar tudo
num painel só e deixar a fronteira confusa.

---

## 2. Modelo de dados (mudanças em relação à v1)

```sql
-- USUÁRIOS DA ADMINISTRAÇÃO TUUVO — time interno, login separado do tenant
tuuvo_users (
  id, email, senha_hash, nome,
  papel,                              -- superadmin (acesso total) | operador (limitado)
  reset_token, reset_token_expira,    -- mesmo fluxo de esqueci senha do tenant
  status, criado_em
)

-- PLANOS DE PREÇO — gerenciados na Administração TUUVO, servidos ao site público
planos (
  id, nome, descricao, preco, preco_sufixo,   -- ex.: "/mês"
  features,                           -- jsonb: ["Webchat ou WhatsApp", "1 departamento", ...]
  destaque,                           -- boolean — "mais escolhido"
  ordem_exibicao, ativo, criado_em
)

-- TENANTS — agora com estado de avaliação explícito
tenants (
  id, nome, slug, status,           -- status: avaliacao | ativo | suspenso | cancelado
  avaliacao_adiada_ate,             -- NULL normalmente; data se o superadmin adiou a decisão
  origem,                           -- 'onboarding' | 'manual' (cadastrado direto pelo superadmin)
  criado_em
)

-- FATURAMENTO — manual por enquanto (ver seção 8), estrutura pronta pra integrar gateway depois
faturamento_mensal (
  id, tenant_id, mes_referencia, valor_mensalidade, valor_consultoria,
  valor_consumo_rcs, valor_consumo_whatsapp_oficial,   -- consumo cobrável, ver seção 7
  lancado_por, criado_em
)

-- USUARIOS — dados mínimos, sem campo que não seja essencial
users (
  id, tenant_id, email, senha_hash, nome,
  papel,                             -- admin | supervisor | agente
  equipe_id,                         -- a qual equipe pertence (nullable)
  permissoes,                        -- jsonb — granular, além do papel (seção 6)
  reset_token, reset_token_expira,   -- fluxo de esqueci minha senha
  status, criado_em
)

equipes (id, tenant_id, nome)         -- agrupamento de usuários (era "departamento" na v1;
                                       -- mantém o mesmo papel de roteamento de canal)

-- CONTATOS — agora com tipo explícito
contacts (
  id, tenant_id, identificador, canal_origem,
  tipo,                              -- 'interno' | 'externo'
  nome, metadata, criado_em
)

-- CONVERSAS — com suporte a transferência
conversations (
  id, tenant_id, channel_connection_id, equipe_id, contact_id,
  status,                            -- aberta | em_atendimento | fechada
  atribuido_a,
  transferida_de, transferida_em,    -- histórico simples de transferência
  aberta_em, fechada_em
)

-- MENSAGENS — com anexo e nota interna
messages (
  id, tenant_id, conversation_id, remetente_tipo, remetente_id,
  conteudo, tipo,                    -- texto | midia | menu | nota_interna
  visivel_pro_solicitante,           -- false = nota interna, true = mensagem normal
  anexos,                            -- jsonb: [{nome, url, tipo, tamanho}]
  id_externo, enviado_em
)
```

O restante do schema da v1 (`channel_connections`, `platform_channel_providers`,
`bot_widgets`, `audit_log`) permanece igual em estrutura.

---

## 3. Canais

### 3.1 Contrato único (`ChannelDriver`) — reforçado

Mantém a interface da v1 (`connect / getStatus / sendText / sendMenu / normalizeInbound`).
A diferença na v2 é **disciplina de uso**: todo canal (exceto e-mail) fala com o resto
do sistema *só* por essa interface — o painel de conversas nunca sabe se está falando
com GTI, Zernio ou webchat nativo. Isso já valia na v1; aqui vira regra explícita de
arquitetura, testada (seção 9).

### 3.2 WhatsApp — dois drivers, mesma interface

| Driver | Uso | Troca de fornecedor |
|---|---|---|
| `whatsapp_gti` | Não-oficial, conversa livre, QR code | Fornecedor pode mudar — só reescrever este driver, resto do sistema intacto |
| `whatsapp_zernio` | Oficial, via Zernio | Mesmo driver genérico da Zernio (seção 3.3), `platform: "whatsapp"` |

### 3.3 Zernio — um driver, N canais por configuração

Confirmado com o usuário: a Zernio é **uma API só cobrindo vários canais**
(WhatsApp oficial, Instagram, Telegram, Facebook, X, Bluesky, Reddit — catálogo
real confirmado na v1, seção 6.3). Driver único `zernio`, diferenciado só pelo
campo `platform` na config da conexão. **Adicionar um canal novo da Zernio pro
tenant é cadastro, não código** — exatamente o requisito do usuário.

### 3.4 RCS — MKOM (sem mudança da v1)

### 3.5 SMS — **removido do escopo**

Decisão explícita: SMS não é canal de conversa usual no Brasil. Não implementar.
(Diferente da v1, que ainda cogitava SMS como canal secundário.)

### 3.6 Chat mobile — reservado, não implementado nesta etapa

Tipo de canal reservado no schema (`channel_connections.tipo = 'mobile'`), sem
SDK nativo construído agora — decisão consciente pra não gastar tempo num canal
sem definição de escopo ainda. Documentado como gap explícito.

### 3.7 E-mail — canal com regra própria (única exceção à transparência de canal)

Diferente de todos os outros, e-mail **não é free text simples** — é free text
**dentro de um bloco delimitado**:

- Toda mensagem enviada pelo agente sai com um cabeçalho fixo:
  ```
  Escreva sua mensagem a partir daqui até a marca ++++++
  
  [conteúdo do agente]
  
  ++++++
  [citação do e-mail anterior, assinatura, etc. — ignorado na leitura]
  ```
- Ao **receber** um e-mail de resposta, o parser do driver de e-mail corta tudo
  que vier depois do delimitador `+++++++` — só o texto acima entra como mensagem
  na conversa. Isso evita que assinatura, disclaimer e histórico de citação
  (comum em cliente de e-mail) virem "conteúdo da conversa".
- Esse comportamento fica **inteiramente dentro do `EmailDriver`** — ele recebe
  o e-mail cru, aplica o parsing do delimitador, e devolve pro resto do sistema
  uma `NormalizedMessage` igual à de qualquer outro canal. O painel de conversas
  não sabe que existe delimitador — só o driver sabe.

---

## 4. Conversa: transferência e nota interna

- **Transferir**: muda `equipe_id` e/ou `atribuido_a` da conversa, grava
  `transferida_de`/`transferida_em`. Quem atendia perde a conversa da própria
  fila; quem recebe, ganha. Evento em tempo real avisa os dois lados.
- **Nota interna**: mensagem com `visivel_pro_solicitante = false`. Aparece na
  timeline da conversa só pro time (visualmente destacada, ex.: fundo amarelo),
  nunca é enviada pro canal externo (não vira WhatsApp/e-mail/etc. de verdade).
- **Anexos**: campo `anexos` (jsonb) em `messages`. Upload vai pra storage
  (a decidir: S3-compatible ou disco local no MVP — não bloqueante pra spec).
- **Exportar conversa**: endpoint que gera um `.txt` ou `.pdf` com a timeline
  completa (mensagens visíveis, não notas internas, a menos que o exportador
  marque a opção de incluir notas).

---

## 5. Relatórios (mini-BI) — novo

Módulo dentro da **Administração do Tenant** (é operacional, sobre a própria
operação do cliente — diferente do dashboard de negócio da Administração TUUVO,
seção 7, que é sobre churn/faturamento entre tenants).

**Filtros comuns a todo relatório**: período (data início/fim), canal, equipe,
agente, status da conversa. Todo relatório abaixo aceita essa mesma combinação
de filtro — implementado como querystring na API (`?de=...&ate=...&canal=...&equipe=...`).

**Visões resumidas (números)**:
- Total de conversas no período (aberta / em atendimento / fechada)
- Tempo médio até a primeira resposta
- Tempo médio até o fechamento
- Conversas por canal (contagem)
- Conversas por equipe / por agente (contagem, útil pra ver carga de trabalho)

**Visões em gráfico**:
- Linha: volume de conversas por dia/semana no período
- Barra: conversas por canal
- Pizza/donut: distribuição por status, ou por equipe

**Exportação**: CSV dos dados agregados (não confundir com "exportar conversa"
da seção 4, que exporta o texto de UMA conversa — aqui é exportar a tabela/
relatório inteiro).

**Fonte dos dados**: consulta direta em `conversations`/`messages` (já têm
`channel_connection_id`, `equipe_id`, `status`, `aberta_em`, `fechada_em`).
Sem tabela nova necessária pro MVP — se o volume crescer a ponto de a consulta
direta ficar lenta, aí sim vale materializar uma tabela de agregação, mas isso
é otimização de depois, não desenho inicial.

## 6. Autenticação e acesso

- Login/senha + **esqueci minha senha** (token por e-mail, expira em X horas).
- **Seleção do que pode acessar**: além do `papel` (admin/supervisor/agente,
  que define o *nível*), existe `permissoes` (jsonb) pra granularidade fina —
  ex.: um agente pode ter permissão de "ver todas as conversas da equipe" ou só
  "ver as próprias". Estrutura pronta, telas cobrem o caso comum (papel) primeiro;
  granular fica configurável via API desde o início, via painel numa fase 2.
- **Acesso ao canal é livre; autenticação do solicitante é responsabilidade de
  cada canal.** A plataforma TUUVO não decide se quem escreveu no webchat é
  "autorizado" — isso é lógica de cada implantação de canal (ex.: o webchat de
  um cliente pode exigir login antes de abrir o chat; isso é customização do
  widget, não da plataforma central).
- **Solicitante interno vs. externo**: campo `contacts.tipo`. Não muda o fluxo
  técnico, é informativo/filtrável (ex.: relatório de quantas conversas internas
  vs. de clientes de fato).

---

## 7. Onboarding → Administração TUUVO

Fluxo (mantendo o padrão self-service de 4 passos da v1, seção 10):

1. Onboarding cria o tenant com `status = 'avaliacao'`, `origem = 'onboarding'`.
2. Config padrão de webchat é aplicada automaticamente (widget com paleta TUUVO
   default, sem o tenant precisar configurar nada pra já ter algo funcionando).
3. Superadmin, ao abrir o tenant recém-criado, vê **quais canais o cliente
   escolheu no onboarding** (grava a escolha, não é preciso adivinhar).
4. Superadmin pode **adiar a avaliação** (`avaliacao_adiada_ate`) — útil quando
   o time ainda não decidiu se aprova/ativa aquele tenant.

---

## 8. Dashboard — Administração TUUVO

### 8.0 Login e usuários do time TUUVO (novo)

Autenticação separada da autenticação de tenant — mesmo padrão técnico (JWT,
hash bcrypt), tabela própria (`tuuvo_users`, seção 2). Dois papéis:
- **Superadmin**: acesso total — cadastra outros usuários TUUVO, vê todos os
  tenants, mexe em planos de preço, dashboard completo.
- **Operador**: acesso limitado — pensado pra quem só precisa operar o
  dia a dia (ex.: aprovar avaliação de tenant, ver dashboard) sem poder mexer
  em plano de preço ou cadastrar outro usuário TUUVO. Granularidade exata fica
  pra quando houver um segundo papel de verdade em uso — a tabela já separa
  `papel`, então adicionar uma permissão nova é dado, não redesenho.

### 8.1 Planos de preço — CRUD + embed público (novo)

Ideia central: **o plano de preço vira dado gerenciável, não texto fixo no
HTML do site**, do mesmo jeito que o Widget Builder trata o widget de chat.

- **CRUD dos planos** na Administração TUUVO (tabela `planos`, seção 2): nome,
  preço, sufixo (ex.: "/mês"), lista de features, se é o "mais escolhido",
  ordem de exibição.
- **Endpoint público** (`GET /public/planos`, sem autenticação, só planos
  `ativo=true`) — mesmo padrão do `GET /tenant/widgets/public/:id` já usado
  pro widget de chat.
- **Script de embed** (`tuuvo-pricing.js`, mesma lógica do `tuuvo-widget.js`):
  o site de marketing carrega esse script, ele busca os planos no endpoint
  público e desenha a seção de preços em tempo real. Muda preço na Administração
  TUUVO → o site atualiza sozinho, sem precisar mexer no HTML do site nem
  fazer novo deploy do marketing.
- Isso substitui a seção de preços **estática** que existia no
  `marketing/index.html` da v1 (números digitados direto no HTML) — na v2, o
  HTML só tem `<div id="tuuvo-pricing"></div>` e o script `tuuvo-pricing.js`
  cuidando do resto.

### 8.2 Métricas do dashboard

Métricas confirmadas na redefinição:
- Tenants ativos (contagem)
- Tenants em avaliação (contagem)
- Churn do mês e churn acumulado
- Faturamento do mês e acumulado no trimestre
- Total em consultoria
- Gráfico dos últimos 3 meses (receita, tenants ativos)
- **Consumo por cliente**: mensagens cobráveis — RCS (MKOM cobra por mensagem,
  valor confirmado na v1) e WhatsApp oficial (Zernio, cobra por conta conectada
  + Meta cobra por mensagem de resposta livre a partir de out/2026, confirmado
  na v1) — isso é rastreável tecnicamente porque cada envio já passa pelo driver
  correspondente; só precisa contar.

Faturamento/consultoria são **valores lançados manualmente** nesta etapa
(tabela `faturamento_mensal`, seção 2) — sem integração de gateway de pagamento
ainda. Estrutura já normalizada por tenant/mês pra plugar Asaas depois sem
redesenho de schema.

---

### 8.3 Relatórios cross-tenant (mesma engine da seção 5, escopo diferente)

O mesmo motor de relatório da seção 5 (filtros de período/canal/equipe, visões
resumidas + gráfico, exportação CSV) fica disponível também na Administração
TUUVO — só que **sem filtro fixo de tenant**, olhando a plataforma inteira.
Só superadmin acessa (não faz sentido pro papel "Operador" por padrão).

Serve pra pergunta diferente da do tenant: não "como está minha operação",
mas "como está o uso da plataforma como um todo" — ex.: qual canal é mais
usado entre todos os clientes, quantas conversas a plataforma processa por dia,
quais tenants têm volume muito acima ou abaixo da média (sinal de risco de
churn ou de upsell).

Tecnicamente é a mesma consulta da seção 5, só tirando a cláusula
`WHERE tenant_id = ...` (com RLS de superadmin, que já enxerga tudo — schema v1,
seção 3) e adicionando `tenant_id`/nome do tenant como dimensão extra nos
grupos, quando fizer sentido (ex.: ranking de tenant por volume).

## 9. O que muda de verdade em relação à v1 (resumo pra quem já leu a v1)

| Item | v1 | v2 |
|---|---|---|
| Estrutura de frontend | 1 painel só | 2 apps separados (Superadmin / Tenant) |
| SMS | Canal ativo (MKOM) | Removido do escopo |
| WhatsApp | Só GTI | GTI (não-oficial) + Zernio (oficial) |
| Redes sociais | Driver Zernio dedicado | Mesmo driver Zernio, generalizado (WhatsApp entra como + 1 platform) |
| E-mail | Não existia | Canal novo, com regra de delimitador própria |
| Chat mobile | Não existia | Reservado no schema, não implementado |
| Transferência de conversa | Não existia | Campo + fluxo dedicado |
| Nota interna | Não existia | Mensagem com `visivel_pro_solicitante=false` |
| Anexo/exportar | Não existia | Campo `anexos` + endpoint de exportação |
| Departamento | `departments` | Renomeado pra `equipes` (mesmo papel) |
| Esqueci senha | Não existia | Fluxo de token por e-mail |
| Dashboard Superadmin | Não existia (só API) | Tela completa, + login próprio do time TUUVO, planos de preço, relatório cross-tenant |
| Avaliação de tenant | Trial fixo de 15 dias | Estado explícito + opção de adiar decisão |
| Relatórios/mini-BI | Não existia | Módulo próprio, tenant e cross-tenant (seção 5 e 8.3) |

---

## 10. Widget Builder — separação Cliente vs. Kernel

Princípio recebido do usuário (documento `webchat-configuracoes-cliente-vs-kernel.md`),
adotado como regra de design pro Widget Builder e generalizável pro resto da
plataforma:

- **Cliente** = personalização de experiência/negócio, exposta em UI/API,
  isolada por tenant, segura de expor sem risco pra outros tenants ou infra.
- **Kernel** = segurança, integridade multi-tenant, infraestrutura compartilhada
  — nunca exposto nem alterável pelo tenant.

Tabela completa (14 categorias — aparência, abertura, mensagens, horário,
roteamento, identidade, bots/IA, notificações, multicanal, segmentação, LGPD,
performance, acessibilidade, analytics) está no documento original, anexado
ao projeto em `docs/webchat-configuracoes-cliente-vs-kernel.md`. Só o resumo
das linhas que **mudam código** desta reconstrução:

| Categoria | Cliente (Widget Builder / API tenant) | Kernel (fixo, não exposto) |
|---|---|---|
| Aparência | cores, logo, avatar, launcher, tema, fonte, animação | engine de render, CSP, sandbox do iframe |
| Abertura | auto-open, delay, gatilho, persistência de sessão (config) | limite min/max de delay, mecanismo de persistência |
| Mensagens | textos, quick replies, campos de formulário | limite de caractere, sanitização (XSS/injection), tipos de arquivo permitidos, scan de anexo |
| Horário | horário de atendimento, fuso, feriados, msg fora do horário | engine de cálculo de disponibilidade |
| Roteamento | equipes, skills, idioma, regra de escalonamento bot→humano | algoritmo de distribuição, motor de fila, limite de concorrência |
| Identidade | exigir CPF/e-mail, campos customizados | geração/validação de JWT, hashing, política de sessão |
| Bots/IA | base de conhecimento, tom do bot | modelo de IA usado, rate limit e quota por tenant |
| Notificações | on/off som/badge/e-mail, URL de webhook | infra de envio (SMTP/push), assinatura/validação de payload |
| Multicanal | quais canais ativar | gestão de token de API dos canais (GTI/Zernio/MKOM), camada de abstração de driver |
| LGPD | texto de consentimento | retenção, criptografia, anonimização de log, auditoria |

**Implicação prática pro código**: `bot_widgets.config_json` (schema v1, seção 4)
só guarda campos da coluna **Cliente**. Qualquer coisa da coluna **Kernel** fica
em variável de ambiente, `platform_channel_providers`, ou constante no código do
driver — nunca em campo editável pelo tenant, nem por API, nem por painel.
Isso vira **checklist de revisão** pra qualquer campo novo que alguém queira
adicionar ao Widget Builder: primeiro perguntar "isso é cliente ou kernel?"
antes de expor.

### 10.1 Tela de configuração — mostrar e reter ao mesmo tempo

Requisito do usuário: uma tela só, onde o tenant configura **todos** os
parâmetros "Cliente" da tabela acima, e o widget de preview reage **em tempo
real** a cada mudança — e o mais importante, o mecanismo de "mostrar" e o de
"guardar pro uso real" são **o mesmo objeto**, não duas coisas sincronizadas
à parte. Isso evita o bug clássico desse tipo de tela (preview bonito que
não bate com o que realmente vai pro ar).

**Mecanismo**: o formulário mantém um objeto `configJson` em memória (estado
local do frontend). Cada campo, ao mudar, atualiza esse objeto E redesenha o
preview a partir dele — o preview não tem estado próprio, ele é uma função
pura de `configJson`. Quando o tenant clica "Salvar" ou "Publicar", é
literalmente esse mesmo objeto que vai pro `PUT /tenant/widgets/:id`
(`bot_widgets.config_json`). Não existe transformação no meio — o que está
na tela é, byte a byte, o que fica gravado e o que o widget de embed real
vai ler depois via `GET /tenant/widgets/public/:id`.

**Campos concretos por categoria** (todos do lado "Cliente" da tabela 10):

| Categoria | Campo na tela | Tipo | Chave em `config_json` |
|---|---|---|---|
| Aparência | Cor primária | color picker | `corPrimaria` |
| Aparência | Cor de fundo | color picker | `corFundo` |
| Aparência | Cor do texto | color picker | `corTexto` |
| Aparência | Logo/avatar | upload de imagem | `avatarUrl` |
| Aparência | Formato do launcher | select (círculo/pílula/quadrado) | `launcherFormato` |
| Aparência | Posição na tela | select (canto inferior direito/esquerdo) | `posicao` |
| Aparência | Tema | select (claro/escuro/automático) | `tema` |
| Aparência | Fonte | select (lista curta de fontes aprovadas) | `fonte` |
| Aparência | Animação | toggle on/off | `animacoesAtivas` |
| Abertura | Abrir automaticamente | toggle | `autoOpen` |
| Abertura | Delay pra abrir sozinho | number (segundos, com min/max validado — o min/max em si é Kernel) | `autoOpenDelaySegundos` |
| Abertura | Gatilho de abertura | select (tempo na página / scroll / clique) | `gatilhoAbertura` |
| Mensagens | Mensagem de boas-vindas | textarea | `mensagemBoasVindas` |
| Mensagens | Mensagem de ausência (fora do horário) | textarea | `mensagemForaHorario` |
| Mensagens | Mensagem de despedida | textarea | `mensagemDespedida` |
| Mensagens | Quick replies / CTA | lista editável (label + ação) | `quickReplies` |
| Mensagens | Campos do formulário pré-chat | lista editável (nome do campo, obrigatório?) | `camposFormulario` |
| Horário | Horário de atendimento | grade dia-da-semana × faixa de hora | `horarioAtendimento` |
| Horário | Fuso horário | select | `fusoHorario` |
| Horário | Feriados | lista de datas | `feriados` |
| Roteamento | Equipe padrão | select (lista de `equipes` do tenant) | `equipeIdPadrao` |
| Roteamento | Idioma de atendimento | select | `idioma` |
| Roteamento | Regra de escalonamento bot→humano | select (sempre / após N perguntas / nunca) | `escalonamentoBotHumano` |
| Identidade | Exigir e-mail antes de conversar | toggle | `exigirEmail` |
| Identidade | Exigir CPF antes de conversar | toggle | `exigirCpf` |
| Identidade | Campos customizados de captura | lista editável | `camposCustomizados` |
| Bots/IA | Base de conhecimento (texto/link) | textarea ou upload | `baseConhecimento` |
| Bots/IA | Tom do bot | select (formal/casual/técnico) | `tomBot` |
| Notificações | Som de notificação | toggle | `somNotificacao` |
| Notificações | Badge de não lida | toggle | `badgeAtivo` |
| Notificações | E-mail de transcrição ao fim do chat | toggle | `emailTranscricao` |
| Notificações | URL de webhook customizado | text (URL) | `webhookCustomizadoUrl` |
| Multicanal | Quais canais ativar neste widget | checkboxes (webchat sempre ligado; outros linkam a canal já conectado) | `canaisAtivos` |
| Segmentação | Regra por página/URL | lista editável (padrão de URL → comportamento) | `regrasSegmentacaoUrl` |
| Segmentação | Segmento de cliente (tag) | text | `segmentoTag` |
| LGPD | Texto do aviso de consentimento | textarea | `textoConsentimentoLgpd` |
| Acessibilidade | Alto contraste disponível pro visitante | toggle | `altoContrasteDisponivel` |
| Analytics | Quais métricas mostrar no dashboard do tenant | checkboxes | `metricasVisiveis` |
| Analytics | ID do Google Analytics/GTM | text | `gaTrackingId` |

Isso é a expansão completa do que hoje (v1) só existia como um subconjunto
pequeno (cor, header, avatar, dimensão, textos básicos) — a v2 cobre as 14
categorias inteiras do documento cliente-vs-kernel, não só aparência.

**Retenção pro uso real do tenant** (a segunda metade do requisito): depois
de "Publicar", o snippet de embed (`<script src=".../tuuvo-widget.js"
data-widget="...">`) já existente na v1 continua sendo o mecanismo de
aplicar isso no site do tenant — a novidade da v2 é só que agora ele carrega
TODOS esses campos, não um subconjunto. Nenhuma mudança de mecanismo de
embed é necessária, só o `config_json` fica mais rico e o `tuuvo-widget.js`
precisa ler os campos novos (trabalho de código, não de arquitetura).

---

## 11. Processo de construção desta vez

Compromisso explícito, pela crítica recebida sobre a v1:
1. **Documentar primeiro** (este arquivo) — revisar com o usuário antes de gerar código.
2. **Comentar por padrão**, não como reforço depois — todo arquivo novo nasce com
   cabeçalho explicando propósito, e comentário nos pontos de decisão não-óbvios.
3. **Separar por responsabilidade** desde o início — dois frontends, drivers isolados,
   sem lógica de canal vazando pro painel.
4. **Validar em sandbox antes de entregar** — cada peça renderizada e testada via
   Chromium headless (Playwright) antes de considerar "pronta", igual ao padrão já
   usado nesta conversa pro restante do projeto.

---

## 12. Índices e performance

Revisão tabela por tabela, pensando no **padrão de consulta real** de cada
uma (não "index tudo") — RLS multi-tenant faz `tenant_id = current_tenant_id()`
em quase toda query, então `tenant_id` lidera a maioria dos índices compostos
abaixo, porque é sempre o primeiro filtro aplicado.

### 12.1 `conversations` — a mais crítica junto com `messages`

```sql
-- lista da inbox: "minhas conversas abertas", ordenado por mais recente
CREATE INDEX idx_conv_tenant_status ON conversations (tenant_id, status, aberta_em DESC);

-- ingestão de mensagem: achar conversa aberta existente pro contato+canal
CREATE INDEX idx_conv_contato_canal ON conversations (tenant_id, contact_id, channel_connection_id, status);

-- fila por equipe (roteamento, relatório)
CREATE INDEX idx_conv_equipe ON conversations (tenant_id, equipe_id, status);

-- conversas atribuídas a um agente
CREATE INDEX idx_conv_atribuido ON conversations (tenant_id, atribuido_a, status);

-- relatório por período (seção 5/8.3), sem filtro de status
CREATE INDEX idx_conv_periodo ON conversations (tenant_id, aberta_em);

-- FK sem índice automático no Postgres
CREATE INDEX idx_conv_channel ON conversations (channel_connection_id);
```

### 12.2 `messages` — maior volume da plataforma

```sql
-- thread de uma conversa, em ordem
CREATE INDEX idx_msg_conversation ON messages (conversation_id, enviado_em);

-- relatório/mini-BI por período direto na mensagem (volume por dia, etc.)
CREATE INDEX idx_msg_tenant_periodo ON messages (tenant_id, enviado_em);
```

**Achado importante revisando isso — risco de integridade, não só performance:**
os webhooks de MKOM e Zernio são **"entrega at-least-once"** (confirmado nas
docs oficiais, seção 6.4/6.3 da especificação v1) — ou seja, o mesmo evento
pode chegar duplicado. Hoje nada impede inserir a mesma mensagem duas vezes.
Recomendo constraint de idempotência:

```sql
-- evita duplicar mensagem se o provedor reenviar o mesmo webhook
CREATE UNIQUE INDEX idx_msg_dedupe ON messages (conversation_id, id_externo)
  WHERE id_externo IS NOT NULL;
```

Com isso, o `INSERT` de mensagem recebida via webhook deve virar
`INSERT ... ON CONFLICT (conversation_id, id_externo) DO NOTHING` — um ajuste
pequeno no `conversation.service.ts` da v1, mas que fecha um bug real de
duplicação que a v1 nunca tratou.

### 12.3 `users` / `tuuvo_users`

```sql
-- login (tenant): já existia como UNIQUE(tenant_id, email) na v1, mantém
-- login (time TUUVO): tabela própria agora, então email já é UNIQUE puro
CREATE UNIQUE INDEX idx_tuuvo_users_email ON tuuvo_users (email);

-- fluxo de esqueci senha, nos dois casos
CREATE INDEX idx_users_reset_token ON users (reset_token) WHERE reset_token IS NOT NULL;
CREATE INDEX idx_tuuvo_users_reset_token ON tuuvo_users (reset_token) WHERE reset_token IS NOT NULL;

-- listar usuários de uma equipe
CREATE INDEX idx_users_equipe ON users (tenant_id, equipe_id);
```

### 12.4 `tenants`

```sql
CREATE UNIQUE INDEX idx_tenants_slug ON tenants (slug);
CREATE INDEX idx_tenants_status ON tenants (status);   -- contagem do dashboard (8.2)

-- follow-up de avaliações adiadas que estão vencendo
CREATE INDEX idx_tenants_avaliacao_adiada ON tenants (avaliacao_adiada_ate)
  WHERE avaliacao_adiada_ate IS NOT NULL;
```

### 12.5 `faturamento_mensal`

```sql
-- 1 lançamento por tenant/mês — evita duplicar e serve de índice de busca
CREATE UNIQUE INDEX idx_fat_tenant_mes ON faturamento_mensal (tenant_id, mes_referencia);

-- agregação por mês (dashboard TUUVO, gráfico trimestral)
CREATE INDEX idx_fat_mes ON faturamento_mensal (mes_referencia);
```

### 12.6 `contacts`

```sql
-- já é UNIQUE(tenant_id, canal_origem, identificador) na v1 — mantém, serve de índice
-- filtro por tipo (interno/externo) em relatório
CREATE INDEX idx_contacts_tipo ON contacts (tenant_id, tipo);
```

### 12.7 `channel_connections` — atenção especial ao JSONB

```sql
-- já existia (tenant_id, tipo) na v1, mantém

-- roteamento de webhook por campo dentro do JSON de config (MKOM cost_centre_id,
-- Zernio accountId) — hoje a v1 faz WHERE (config->>'accountId') = $1 sem índice,
-- ou seja, table scan a cada webhook recebido. Corrigir com índice de expressão:
CREATE INDEX idx_channel_config_accountid ON channel_connections ((config->>'accountId'));
CREATE INDEX idx_channel_config_costcentre ON channel_connections ((config->>'cost_centre_id'));
```

### 12.8 `platform_channel_providers`, `bot_widgets`, `audit_log`, `equipe_channels`

```sql
CREATE INDEX idx_providers_tipo_ativo ON platform_channel_providers (tipo, ativo);
CREATE INDEX idx_widgets_tenant ON bot_widgets (tenant_id);
CREATE INDEX idx_audit_tenant_data ON audit_log (tenant_id, criado_em DESC);

-- junção equipe<->canal: PK composta (equipe_id, channel_connection_id) já
-- otimiza busca "canais de uma equipe"; falta o sentido inverso:
CREATE INDEX idx_equipe_channels_reverso ON equipe_channels (channel_connection_id);
```

### 12.9 O que **não** indexar

Vale registrar isso também — índice em excesso piora performance de escrita
(todo `INSERT`/`UPDATE` mantém todos os índices da tabela):
- Não criar índice em `equipes` além do `tenant_id` — tabela pequena (dezenas
  de linhas por tenant), scan sequencial já é rápido.
- Não indexar `messages.conteudo` (texto livre) a menos que se decida implementar
  busca full-text de verdade — nesse caso seria um índice GIN com `to_tsvector`,
  não um índice comum, e é uma decisão separada (custo de armazenamento e
  manutenção maior).
- Não indexar `anexos` (jsonb) a menos que surja um caso de uso de filtrar
  conversa "que tem anexo" — não apareceu como requisito ainda.

---

## 13. Canais em aplicações externas — o que ficou explícito

Pergunta direta do usuário revelou uma lacuna real: o código falava em
"embed" e "SDK" mas não tinha o arquivo do script nem a chave de acesso pra
uso de verdade fora da TUUVO. Resolvido em dois mecanismos, um por tipo de
necessidade:

### 13.1 Webchat — `widget/tuuvo-widget.js`

Script único, sem framework, que o tenant cola em **qualquer aplicação
externa** (WordPress, React, HTML estático):

```html
<script src="https://SEU-BACKEND/tuuvo-widget.js"
  data-tenant="ID_DO_TENANT" data-widget="ID_DO_WIDGET"
  data-backend="https://SEU-BACKEND"></script>
```

Busca a config publicada (`GET /tenant/widgets/public/:id`), desenha a bolha
e o painel de chat, conecta no tempo real via Socket.IO. O snippet exato,
já com os IDs certos, é gerado automaticamente na tela do Widget Builder
depois de publicar (seção 10.1) — o tenant só copia e cola.

### 13.2 WhatsApp, RCS, e-mail — API Key

Diferente do webchat, esses canais não são "embutidos visualmente" — uma
aplicação externa do tenant (ex.: o CRM interno deles) usa via chamada de
API pra `/conversations/*`. Como o JWT normal expira em horas (pensado pra
sessão de humano logado no painel), isso não serve pra integração
servidor-a-servidor de longa duração. Resolvido com:

- Tabela `api_keys` — chave gerada uma vez, mostrada em texto puro só na
  criação, guardada só como hash daí em diante (mesmo padrão de senha).
- Middleware `requireTenantAuthOrApiKey` — aceita header `X-API-Key` OU o
  JWT normal, nas MESMAS rotas (`/conversations/*`) — o resto do código não
  precisa saber qual dos dois foi usado.
- Tela "Integrações" na Administração do Tenant — gerar, listar (só prefixo
  visível depois de criada) e revogar chave.

### 13.3 Achado técnico no processo

Ao escrever o `tuuvo-widget.js`, o handshake do Socket.IO que eu tinha
escrito mandava `widgetId` via `query` mas o backend (`realtime/socket.ts`)
só lia de `handshake.auth` — mensagem nunca chegaria no widget publicado.
Achado e corrigido antes de empacotar, não depois de alguém tentar usar em
produção e não funcionar.

### 13.4 Painel inteiro embutido em outra plataforma (ex.: AltDesk, e não só ela)

Diferente das seções 13.1-13.2 (canal usado de fora), isso é o **painel de
conversas da TUUVO rodando dentro da tela de outra plataforma** — o caso de
uso explícito do AltDesk ser a primeira plataforma a integrar. **O mecanismo
em si não é exclusivo do AltDesk**: qualquer plataforma externa com uma API
key ativa (seção 13.2) usa exatamente o mesmo caminho — nada no código
verifica "é o AltDesk?", só verifica "a API key é válida?". Isso importa
porque múltiplas integrações rodando em paralelo é um cenário esperado, não
hipotético — a tabela `api_keys` já suporta N chaves nomeadas por tenant
desde o desenho original (seção 13.2), uma por integração.

**Modo embed do frontend** (`admin-tenant/`, `?embed=1&token=...`):
- Sidebar inteira some — o host controla o "chrome" ao redor
- Pula a tela de login — usa o token que já vem pronto na URL
- Abre direto na caixa de conversas

**Como o host consegue o token**: endpoint novo
`POST /tenant/auth/emitir-token-embed`, protegido por API key (seção 13.2)
— não pelo agente diretamente. Fluxo real:
1. Agente loga na plataforma externa (autenticação dela, não da TUUVO)
2. Backend dela chama a rota acima com a API key do tenant + e-mail do agente
3. Recebe um JWT de 1h, monta a URL do iframe:
   `<iframe src="https://painel.tuuvo.app.br/?embed=1&token=TOKEN&backend=https://api.tuuvo.app.br">`

**Rastreabilidade entre integrações**: cada emissão de token grava em
`audit_log` o nome da API key usada (ou seja, qual integração pediu) — com
2+ plataformas ativas ao mesmo tempo, dá pra responder "quem pediu acesso
pra esse agente, e quando" sem ficar às cegas.

**Limite explícito**: o e-mail do agente precisa já existir como usuário
TUUVO daquele tenant — esta rota não cria usuário novo. Como isso é
provisionado (criar automaticamente no primeiro acesso? sincronizar cadastro
entre a plataforma externa e a TUUVO?) é decisão de produto **por
integração** — pode ser diferente pro AltDesk e pra próxima plataforma que
vier, não precisa ser uma decisão única e global.

### 13.5 Achados no processo

1. Ao revisar pra essa integração, confirmei que a v1 tinha o modo embed e a
   v2 **não trouxe isso na reconstrução** — ficou só o embed de widget
   (13.1). Como o plano do usuário é literalmente essa integração agora,
   não era gap teórico, era bloqueio real pro próximo passo. Corrigido
   antes de qualquer trabalho no lado do AltDesk começar.
2. A emissão de token não tinha rastro de auditoria — funcionava, mas
   virava caixa-preta assim que uma segunda plataforma externa começasse a
   usar o mesmo mecanismo. Corrigido antes de virar problema, não depois de
   alguém perguntar "por que esse agente tem acesso" sem conseguir responder.

---

## 14. Cobrança — medição de consumo (feito) e integração de pagamento (adiado)

Divisão consciente entre duas coisas que estavam faladas como "cobrança" só,
misturadas: **medir consumo** (interno, sem depender de nada externo) e
**cobrar de verdade** (externo, precisa de credencial real da Asaas — o
usuário já tem isso pronto do AltDesk, vai trazer o código de lá).

### 14.1 O que confirmamos direto na documentação oficial da Meta

- WhatsApp oficial tem **4 categorias cobráveis**: marketing, utility,
  authentication (templates) e service (resposta livre, não-template) — a
  partir de 1º/10/2026 mensagem de serviço também passa a ser cobrada, na
  mesma tarifa de utility/authentication do país, **sem faixa de volume**
  (diferente de utility/authentication, que têm desconto por volume).
- Tarifa varia por **categoria + país + faixa de volume mensal**.
- **Não existe fee mensal cobrado pela própria Meta** — o modelo é 100% por
  mensagem. O fee mensal que existe é o aluguel do número (via Zernio,
  $2-25/mês por país, já confirmado antes) — coisa diferente, não confundir.
- Brasil migrou pra faturamento em BRL a partir de julho/2026.
- **Não conseguimos os valores exatos em BRL** — estão num CSV assinado do
  CDN da própria Meta, sem acesso direto. Agregadores de terceiros
  discordam entre si (3 fontes, 3 números diferentes pra Brasil) — por isso
  não usamos nenhum deles como se fosse fato.

### 14.2 RCS — pendente de dado do cliente

Confirmado: RCS (MKOM) tem 3 tipos com preço distinto — simples, multimídia,
conversation — em vez do valor único que estava assumido antes (R$0,09-0,15
flat). Os 3 valores específicos ainda não foram fornecidos.

### 14.3 O que foi construído agora

- **`tarifas_canal`** — tabela nova, preço por canal+categoria+país+data de
  vigência. Todas as linhas de seed hoje têm **valor 0, marcadas
  PLACEHOLDER** — nenhum número foi inventado.
- **`messages.categoria_cobranca`** — toda mensagem enviada via WhatsApp
  oficial ou RCS grava sua categoria no momento do envio (`service` pra
  resposta livre no WhatsApp oficial; `simples` pro RCS padrão — mapeamento
  pragmático de hoje, evolui quando o agente puder escolher tipo/categoria
  na hora de responder).
- **`consumo.service.ts`** (`calcularConsumoMensal`) — soma mensagens reais
  por categoria no mês, multiplica pela tarifa vigente, devolve total por
  canal. Testado (matemática de virada de mês/ano, incluindo ano bissexto).
- **`GET /tuuvo/faturamento/consumo-calculado`** — superadmin confere o
  cálculo antes de lançar (não grava sozinho, por decisão — as tarifas
  ainda são placeholder).

**Import direto**: com os dados de tarifa ainda zerados, o cálculo sai
R$0,00 hoje — isso é o **comportamento correto e esperado**, não um bug.
Assim que os valores forem confirmados (BRL da Meta + os 3 tipos do MKOM),
basta atualizar `tarifas_canal` — nenhuma mudança de código necessária, o
cálculo já funciona.

**Atualização**: o texto abaixo (14.3) foi escrito quando as tarifas ainda
eram zero — depois, a pedido do usuário, viraram valores DUMMY não-zero pra
testar a estrutura de ponta a ponta (ver 14.5). O cálculo em si não mudou,
só deixou de sair R$0,00.

### 14.4 Integração Asaas — adiado por decisão, não por limite técnico

O usuário já tem essa integração pronta e testada no AltDesk — trazer o
código de lá é mais rápido e mais confiável do que eu implementar do zero
sem conta real pra testar contra. Ver seção 13 pra estrutura de dados já
preparada (`faturamento_mensal` normalizada por tenant/mês) — plugar a
Asaas ali não deve exigir redesenho de schema, só a camada de integração.

### 14.5 Correção importante: custo ≠ preço de venda

Achado do usuário depois da primeira versão: `tarifas_canal` estava
guardando **um valor só**, misturando duas coisas diferentes:
- **Custo** = o que a Meta/MKOM cobra da TUUVO (fornecedor)
- **Preço de venda** = o que a TUUVO cobra do tenant (decisão da
  Administração TUUVO, não precisa ser custo+markup fixo)

Corrigido: `tarifas_canal` agora tem `custo_unitario` e `preco_unitario`
como colunas separadas. `faturamento_mensal` ganhou `valor_custo_rcs` /
`valor_custo_whatsapp_oficial` ao lado dos `valor_consumo_*` já existentes
(que agora representam RECEITA, não custo) — dá pra ver margem por tenant,
não só faturamento.

**Valores hoje são DUMMY, não zero** — por pedido explícito, pra estrutura
inteira (medição → cálculo → faturamento) ser testável de ponta a ponta
antes dos números reais chegarem. Custo dummy é uma estimativa arredondada;
preço dummy é custo × ~2,5 (markup ilustrativo, não é recomendação — só pra
mostrar custo e preço saindo diferentes um do outro, provando que a
separação funciona). `PATCH /tuuvo/tarifas/:id/preco` edita só o preço de
venda — custo não se edita por ali, vem do fornecedor.

Testado: simulação com 500 mensagens WhatsApp oficial (categoria service) +
200 RCS (simples) usando os valores dummy — custo e receita saem números
diferentes e coerentes (margem positiva em ambos), confirmando que o cálculo
está certo, não só a estrutura.
