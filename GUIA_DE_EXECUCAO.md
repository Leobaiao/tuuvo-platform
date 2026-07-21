# Guia de Execução — TUUVO Conversation Platform

Passo a passo para rodar o scaffold localmente, numa máquina com Docker
(diferente do sandbox usado para gerar este projeto, que não tem Docker nem
acesso à internet).

---

## Pré-requisitos

- **Docker** e **Docker Compose** instalados.
  - Windows/Mac: [Docker Desktop](https://www.docker.com/products/docker-desktop/)
  - Linux: pacotes `docker` e `docker-compose-plugin` (ou `docker compose`, sem hífen, dependendo da versão)
- **Node.js** instalado localmente (só para o passo 2 — gerar um hash de senha). Qualquer versão 18+ serve.
- Portas livres na máquina: `5433` (Postgres), `3000` (backend), `8081` (frontend).

---

## Passo 1 — Descompacte o projeto

```bash
unzip tuuvo-platform.zip
cd tuuvo-platform
```

---

## Passo 2 — Gere uma senha real para o Superadmin

O seed do banco (`db/schema.sql`) vem com um hash de senha **placeholder**,
que não corresponde a nenhuma senha de verdade — é só pra não deixar o campo
vazio. Gere um hash bcrypt real:

```bash
node -e "console.log(require('bcryptjs').hashSync('SUA_SENHA_AQUI', 10))"
```

> Se der erro de `Cannot find module 'bcryptjs'`, rode primeiro `npm install bcryptjs` numa pasta qualquer, ou execute esse comando de dentro de `backend/` depois do `npm install` (passo 4 já resolve isso via Docker, mas esse comando específico roda fora do container).

Isso imprime algo como:
```
$2b$10$N9qo8uLOickgx2ZMRZoMy.MqOF7d6E9DUwKZjMR.k5m5.YbY2X0Zi
```

Copie esse valor.

---

## Passo 3 — Cole o hash no schema

Abra `db/schema.sql`, vá até a última linha do arquivo:

```sql
INSERT INTO users (tenant_id, email, senha_hash, nome, papel)
VALUES (NULL, 'superadmin@tuuvo.app.br', '$2b$10$replace.with.a.real.bcrypt.hash.on.setup', 'Superadmin', 'superadmin');
```

Substitua **só a parte entre aspas do `senha_hash`**
(`$2b$10$replace.with.a.real.bcrypt.hash.on.setup`) pelo hash gerado no
passo 2. Salve o arquivo.

⚠️ Esse arquivo só roda automaticamente na **primeira vez** que o Postgres
sobe (é um script de inicialização). Se você já subiu o `docker-compose`
antes de editar isso, veja a seção de Troubleshooting mais abaixo (item
"mudei o schema.sql mas nada muda").

---

## Passo 4 — Suba os três serviços

Na raiz do projeto (onde está o `docker-compose.yml`):

```bash
docker-compose up --build
```

(Em versões mais novas do Docker, pode ser `docker compose up --build`, sem hífen.)

Isso builda e sobe:
| Serviço | Porta | O que é |
|---|---|---|
| `postgres` | 5433 | Banco de dados (schema criado automaticamente) |
| `backend` | 3000 | API REST + Socket.IO + serve o widget de embed |
| `frontend` | 8081 | Painel do cliente (nginx servindo arquivos estáticos) |

Na primeira vez demora um pouco (baixa as imagens Docker, instala as
dependências do backend). Deixe o terminal aberto — os logs dos três
serviços aparecem entrelaçados ali. Pra rodar em background, use `-d`:
`docker-compose up --build -d`, e veja os logs depois com
`docker-compose logs -f`.

---

## Passo 5 — Confirme que o backend está de pé

Em outro terminal:

```bash
curl http://localhost:3000/health
```

Resposta esperada:
```json
{"ok":true,"service":"tuuvo-backend"}
```

Se der erro de conexão recusada, veja Troubleshooting.

---

## Passo 6 — Login como Superadmin

```bash
curl -X POST http://localhost:3000/auth/login \
  -H "Content-Type: application/json" \
  -d '{"email":"superadmin@tuuvo.app.br","senha":"SUA_SENHA_AQUI"}'
```

Use a mesma senha em texto puro que você usou no passo 2 (o hash fica no
banco, mas você loga com a senha original). A resposta traz um `token` —
copie ele, vai ser usado no próximo passo.

---

## Passo 7 — Crie o primeiro tenant (cliente)

```bash
curl -X POST http://localhost:3000/superadmin/tenants \
  -H "Authorization: Bearer TOKEN_DO_PASSO_6" \
  -H "Content-Type: application/json" \
  -d '{
    "nome": "Loja Exemplo",
    "slug": "loja-exemplo",
    "adminEmail": "admin@loja.com",
    "adminSenha": "SenhaForte123"
  }'
```

Isso já cria automaticamente: o tenant, o usuário admin (`admin@loja.com`) e
um departamento padrão chamado "Atendimento Geral".

---

## Passo 8 — Abra o painel

Vá em **http://localhost:8081** no navegador e faça login com
`admin@loja.com` / `SenhaForte123`.

A partir daqui, tudo é pela interface:
- **Departamentos** → criar mais setores (Comercial, Suporte, etc.)
- **Canais** → conectar webchat (um clique), WhatsApp (pede token da GTI),
  SMS/RCS (pedem que um provider da MKOM já esteja cadastrado no
  Superadmin — ver seção opcional abaixo)
- **Widget Builder** → montar a aparência do chat com preview ao vivo, publicar
- **Equipe** → convidar mais agentes
- **Conversas** → atender, atribuir a si mesmo, encerrar

---

## (Opcional) Cadastrar credenciais de SMS/RCS no Superadmin

Canais de SMS e RCS usam um broker (MKOM) cadastrado **uma vez a nível de
plataforma**, não por tenant. Antes de conectar SMS/RCS pelo painel, cadastre
o provider:

```bash
curl -X POST http://localhost:3000/superadmin/channel-providers \
  -H "Authorization: Bearer TOKEN_DO_SUPERADMIN" \
  -H "Content-Type: application/json" \
  -d '{
    "tipo": "sms",
    "nome": "MKOM - MKSMS",
    "endpointBase": "https://sms.mkmservice.com/sms/api/transmission/v1",
    "token": "SEU_TOKEN_MKOM_AQUI"
  }'
```

Repita trocando `"tipo": "rcs"` se quiser habilitar RCS também (o endpoint é
o mesmo, o token pode ser o mesmo ou diferente, dependendo de como a MKOM
organiza sua conta).

---

## Testando o widget isolado (fora do painel)

O backend já serve o SDK de embed estaticamente:

```
http://localhost:3000/demo.html
```

Edite esse arquivo (`widget/demo.html`) trocando `data-tenant` e
`data-widget` pelos IDs reais — o `tenantId` você pega no `user.tenantId` da
resposta de login do passo 7/8, e o `widgetId` aparece na tela do Widget
Builder depois de criado.

---

## Troubleshooting

**`docker-compose: command not found`**
Docker Compose pode estar integrado ao Docker CLI em versões novas — tente
`docker compose up --build` (sem hífen).

**Porta já em uso (`address already in use`)**
Alguma das portas 5433/3000/8081 já está ocupada por outro processo. Pare o
que estiver usando essa porta, ou edite o `docker-compose.yml` trocando o
lado esquerdo do mapeamento de porta (ex.: `"5434:5432"` em vez de
`"5433:5432"`).

**Mudei o `db/schema.sql` mas nada muda**
O Postgres só roda os scripts de `docker-entrypoint-initdb.d` (que é onde
`schema.sql` está montado) na **primeira vez** que o volume de dados é
criado. Se você já tinha subido antes, o banco já existe e o script não
roda de novo. Pra forçar recriação (⚠️ **apaga todos os dados**):
```bash
docker-compose down -v
docker-compose up --build
```

**Login do superadmin retorna "Credenciais inválidas"**
Confirma que colou o hash certo no `schema.sql` *antes* da primeira subida
(ver item acima se já subiu antes), e que está usando a senha em texto
puro (não o hash) no `curl` de login.

**Erro de CORS ou "Failed to fetch" no painel**
Confirma que o backend está respondendo em `http://localhost:3000/health`.
Se você mudou a porta do backend no `docker-compose.yml`, o frontend
também precisa apontar pra porta nova — isso é configurado via querystring
(`js/config.js` lê `?backend=...` da URL, com fallback pra
`http://localhost:3000`).

**Canal de WhatsApp fica em `qr_pending` para sempre**
Isso é esperado até alguém escanear o QR code de verdade no WhatsApp da
empresa. O QR retorna na resposta do `POST /tenant/channels/whatsapp` (ou
aparece na tela de Canais do painel).

---

## Próximo passo depois disso funcionando

Ver a seção "O que falta para produção" no `README.md` e a seção 14
(roadmap) do `TUUVO_Arquitetura_Tecnica.md` — este guia cobre só o
ambiente de desenvolvimento local, não deploy em produção.
