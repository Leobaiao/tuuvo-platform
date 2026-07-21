# TUUVO Conversation Platform — Scaffold

Implementação inicial da especificação em `TUUVO_Arquitetura_Tecnica.md`. Cobre o
**núcleo** (Postgres com RLS multi-tenant, auth, Superadmin, departamentos),
**webchat ponta a ponta** (widget embutível + tempo real via Socket.IO), os
**drivers de canal plugáveis** para WhatsApp (GTI), SMS e RCS (MKOM), e agora
o **frontend do painel do cliente**: Widget Builder funcional e caixa de
conversas multicanal com múltiplos agentes em tempo real.

Isto é um scaffold funcional, não um produto pronto para produção: seções
inteiras (fila de eventos com Redis, mapeamento robusto de `cost_centre_id`
da MKOM para conexão, testes automatizados, deploy) ficam como próximos
passos naturais — ver seção 14 da especificação.

**Passo a passo detalhado pra rodar (Docker, hash de senha, troubleshooting):
ver `GUIA_DE_EXECUCAO.md`.** O restante deste README é uma referência mais
resumida da estrutura e dos comandos principais.

## Estrutura

```
tuuvo-platform/
├── db/schema.sql          # Schema Postgres + RLS por tenant
├── backend/                # API REST + Socket.IO (Node/TypeScript)
│   └── src/
│       ├── drivers/        # ChannelDriver (interface) + WhatsApp/GTI + SMS-RCS/MKOM
│       ├── routes/         # auth, superadmin, tenant, conversations, webhooks
│       ├── realtime/       # gateway Socket.IO (webchat + painel multi-agente)
│       └── services/       # auth, ingestão de conversa
├── frontend/                # Painel do cliente (HTML/CSS/JS puro, sem build step)
│   └── js/views/             # inbox (conversas), departments, channels, widgetBuilder, team
├── widget/                  # SDK de embed (vanilla JS) + página sandbox
├── admin-preview/            # Mock visual estático (sem chamadas reais — só pra visualizar o desenho)
├── docker-compose.yml
└── TUUVO_Arquitetura_Tecnica.md
```

**Diferença importante entre `frontend/` e `admin-preview/`:** o `admin-preview`
é uma maquete com dados fictícios, sem chamada nenhuma pra API — só pra ver o
desenho da tela rápido. O `frontend/` é o painel de verdade: login real,
consome as rotas do backend, tempo real via Socket.IO, e é o que o cliente
efetivamente usaria para montar o chat e atender conversas.

## Rodando localmente

```bash
docker-compose up --build
```

Isso sobe:
- **Postgres** na porta `5433` (schema criado automaticamente na primeira subida)
- **Backend** na porta `3000` (e também serve `widget.js` e `demo.html` estaticamente)
- **Frontend** na porta `8081` → abra `http://localhost:8081`

Teste: `curl http://localhost:3000/health`

### Criar o primeiro tenant (via Superadmin)

O seed do banco cria um usuário `superadmin@tuuvo.app.br`, mas com um hash de
senha placeholder — gere um hash bcrypt real antes de logar:

```bash
node -e "console.log(require('bcryptjs').hashSync('SUA_SENHA_AQUI', 10))"
```

Atualize a linha do seed em `db/schema.sql` (ou rode um `UPDATE users SET
senha_hash = '...' WHERE email = 'superadmin@tuuvo.app.br'` direto no Postgres)
antes da primeira subida — depois disso, faça login:

```bash
curl -X POST http://localhost:3000/auth/login \
  -H "Content-Type: application/json" \
  -d '{"email":"superadmin@tuuvo.app.br","senha":"SUA_SENHA_AQUI"}'
```

Com o token retornado, crie um tenant (isso já cria o admin do tenant e um
departamento padrão "Atendimento Geral", ver `superadmin.routes.ts`):

```bash
curl -X POST http://localhost:3000/superadmin/tenants \
  -H "Authorization: Bearer SEU_TOKEN" \
  -H "Content-Type: application/json" \
  -d '{"nome":"Loja Exemplo","slug":"loja-exemplo","adminEmail":"admin@loja.com","adminSenha":"SenhaForte123"}'
```

### Usando o painel (frontend)

Abra `http://localhost:8081`, logue com `admin@loja.com` / a senha usada
acima. De lá dá pra: criar departamentos, conectar canais (webchat nasce
pronto; WhatsApp pede o token de instância da GTI; SMS/RCS pedem um
`cost_centre_id` — e exigem que um provider da MKOM já esteja cadastrado no
Superadmin, ver `POST /superadmin/channel-providers`), montar o widget com
preview ao vivo e publicar, convidar mais agentes, e atender conversas na
caixa de entrada.

**Multi-agente:** todo agente logado no painel entra na "sala" do tenant via
Socket.IO. Quando uma mensagem chega ou uma conversa é atribuída/encerrada,
todos veem em tempo real — inclusive o badge de quem está atendendo, pra
evitar dois agentes respondendo a mesma conversa sem perceber.

### Testando o widget isolado

Abra `http://localhost:3000/demo.html` (o backend já serve o widget
estaticamente) — ajuste `data-tenant`/`data-widget` para IDs reais criados
via o painel.

### Embutindo o painel de conversas em outra plataforma (ex.: AltDesk)

A caixa de conversas (`frontend/index.html`) foi desenhada pra funcionar
dentro de um `<iframe>`, não só standalone — é a peça que resolve o pedido de
"facilidade de implementação em outras plataformas":

```html
<iframe
  src="https://painel.tuuvo.app.br/?embed=1&backend=https://api.tuuvo.app.br&token=JWT_DO_AGENTE"
  style="width:100%; height:100%; border:0;">
</iframe>
```

Com `embed=1`: a navegação lateral inteira some (o host controla o "chrome"
ao redor) e o painel abre direto na caixa de conversas, sem tela de login —
usa o `token` já pronto que a plataforma host passou na URL. **Importante:**
esse `token` precisa ser um JWT válido emitido pelo backend da TUUVO — como o
AltDesk obtém esse token (login server-to-server, SSO, etc.) fica fora do
escopo deste frontend e é o próximo ponto de integração real a desenhar.

### Preview visual (mock, sem precisar de nada rodando)

Abra `admin-preview/index.html` direto no navegador — dados fictícios,
zero chamada de API, só pra visualizar o desenho do painel rapidamente.

## O que falta para produção

Ver seção 14 (roadmap) e seção 15 (decisões) da especificação. Pontos
técnicos que este scaffold deixa como TODO explícito no código:
- Fila de eventos (Redis) para processar callbacks de webhook em vez de
  tratar tudo síncrono na requisição (recomendação da própria documentação
  MKOM, seção 6.4).
- Mapeamento `cost_centre_id` → `channel_connection` da MKOM hoje depende de
  um campo `config` livre; merece uma tabela dedicada em escala.
- Driver de Voz — canal reservado no schema (`tipo = 'voz'`), sem
  implementação até o provedor ser escolhido (seção 6.6).
- Integração real de auth entre o AltDesk (ou qualquer host) e a TUUVO para
  o modo embutido — hoje o frontend só sabe *consumir* um token pronto, não
  como obtê-lo do lado do host.
- Indicador de mensagem não lida / contagem de fila por departamento na
  caixa de entrada — hoje a lista só reordena/atualiza prévia em tempo real,
  sem contador de não-lidas.
