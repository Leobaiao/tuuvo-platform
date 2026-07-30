-- ============================================================================
-- TUUVO — Schema Postgres v2
-- Referência: TUUVO_Arquitetura_v2.md (seções 2 e 12)
--
-- Diferenças estruturais em relação à v1:
--   - tuuvo_users: login do TIME TUUVO, separado do login de tenant
--   - planos: preço gerenciável (não mais texto fixo no site)
--   - faturamento_mensal: base do dashboard de negócio (seção 8.2)
--   - equipes: renomeado de "departments" (mesmo papel)
--   - contacts.tipo: interno | externo
--   - conversations: transferência (transferida_de/em)
--   - messages: nota interna (visivel_pro_solicitante) + anexos
--   - índice de dedupe em messages (webhook at-least-once, seção 12.2)
-- ============================================================================

CREATE EXTENSION IF NOT EXISTS "pgcrypto";

-- ----------------------------------------------------------------------------
-- ADMINISTRAÇÃO TUUVO (nível plataforma, fora de qualquer tenant)
-- ----------------------------------------------------------------------------

-- Login do TIME TUUVO — separado do login de usuário de tenant (seção 8.0).
-- "superadmin" = acesso total. "operador" = acesso limitado (dashboard,
-- aprovar avaliação), sem mexer em plano de preço ou cadastrar outro usuário TUUVO.
CREATE TABLE tuuvo_users (
    id              UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    email           TEXT UNIQUE NOT NULL,
    senha_hash      TEXT NOT NULL,
    nome            TEXT,
    papel           TEXT NOT NULL DEFAULT 'operador', -- superadmin | operador
    reset_token     TEXT,
    reset_token_expira TIMESTAMPTZ,
    status          TEXT NOT NULL DEFAULT 'ativo',
    criado_em       TIMESTAMPTZ NOT NULL DEFAULT now()
);

-- Planos de preço — CRUD na Administração TUUVO, servido ao site via
-- endpoint público + script de embed tuuvo-pricing.js (seção 8.1).
CREATE TABLE planos (
    id              UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    nome            TEXT NOT NULL,
    descricao       TEXT,
    preco           NUMERIC(10,2),   -- NULL = "sob consulta" (ex.: plano Agência)
    preco_sufixo    TEXT DEFAULT '/mês',
    features        JSONB NOT NULL DEFAULT '[]',  -- ["Webchat ou WhatsApp", "1 equipe", ...]
    destaque        BOOLEAN NOT NULL DEFAULT false, -- "mais escolhido"
    ordem_exibicao  INT NOT NULL DEFAULT 0,
    ativo           BOOLEAN NOT NULL DEFAULT true,
    criado_em       TIMESTAMPTZ NOT NULL DEFAULT now()
);

-- Credenciais de brokers a nível de plataforma (SMS/RCS via MKOM, WhatsApp
-- oficial e redes sociais via Zernio) — não é por tenant. Ver seção 3.2/3.3.
CREATE TABLE platform_channel_providers (
    id              UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    tipo            TEXT NOT NULL,              -- rcs | zernio | (voz no futuro)
    nome            TEXT NOT NULL,
    endpoint_base   TEXT NOT NULL,
    credenciais_enc BYTEA NOT NULL,
    config          JSONB NOT NULL DEFAULT '{}',
    ativo           BOOLEAN NOT NULL DEFAULT true,
    criado_em       TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE INDEX idx_providers_tipo_ativo ON platform_channel_providers (tipo, ativo);

-- Tenants — com estado de avaliação explícito e rastro de onboarding (seção 6).
CREATE TABLE tenants (
    id                    UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    nome                  TEXT NOT NULL,
    slug                  TEXT UNIQUE NOT NULL,
    status                TEXT NOT NULL DEFAULT 'avaliacao', -- avaliacao | ativo | suspenso | cancelado
    avaliacao_adiada_ate  TIMESTAMPTZ,          -- NULL normalmente; data se o superadmin adiou a decisão
    origem                TEXT NOT NULL DEFAULT 'manual',    -- onboarding | manual
    canais_escolhidos_onboarding JSONB DEFAULT '[]',         -- o que o cliente marcou no onboarding
    limites               JSONB NOT NULL DEFAULT '{"max_conexoes": 3, "max_agentes": 5}',
    criado_em             TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE UNIQUE INDEX idx_tenants_slug ON tenants (slug);
CREATE INDEX idx_tenants_status ON tenants (status);
CREATE INDEX idx_tenants_avaliacao_adiada ON tenants (avaliacao_adiada_ate)
    WHERE avaliacao_adiada_ate IS NOT NULL;

-- Tarifa por categoria de mensagem cobrável (arquitetura v2, seção 14).
-- WhatsApp oficial: Meta cobra por categoria (marketing/utility/authentication/
-- service) e por país — NÃO tem fee mensal da Meta em si (confirmado na doc
-- oficial); o "fee mensal" é o aluguel do número via Zernio (seção 3.3/13),
-- separado disso. RCS/MKOM: 3 tipos (simples/multimidia/conversation), cada
-- um com preço próprio — valores ainda não confirmados, ver comentário na
-- linha de seed abaixo.
-- Tarifa por categoria de mensagem cobrável (arquitetura v2, seção 14).
-- DOIS valores, propositalmente separados — não são a mesma coisa:
--   custo_unitario  = o que a META/MKOM cobra da TUUVO (fornecedor)
--   preco_unitario  = o que a TUUVO cobra do TENANT (decisão da Administração
--                     TUUVO — não precisa ser custo+markup fixo, o Admin
--                     escolhe o preço que quiser pra cada categoria)
CREATE TABLE tarifas_canal (
    id             UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    canal          TEXT NOT NULL,      -- whatsapp_oficial | rcs
    categoria      TEXT NOT NULL,      -- whatsapp: marketing|utility|authentication|service
                                        -- rcs: simples|multimidia|conversation
    pais           TEXT NOT NULL DEFAULT 'BR',  -- custo da Meta varia por país
    custo_unitario NUMERIC(10,4) NOT NULL,      -- 4 casas — fração de centavo é comum
    preco_unitario NUMERIC(10,4) NOT NULL,      -- preço de venda pro tenant — Admin TUUVO decide
    moeda          TEXT NOT NULL DEFAULT 'BRL',
    vigente_desde  DATE NOT NULL DEFAULT CURRENT_DATE,
    fonte_custo    TEXT,               -- de onde veio o número de custo (link/print/confirmação verbal)
    criado_em      TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE UNIQUE INDEX idx_tarifas_vigente ON tarifas_canal (canal, categoria, pais, vigente_desde);

-- Faturamento — lançamento manual por enquanto (seção 8.2), 1 linha por tenant/mês.
-- Estrutura já pronta pra integrar gateway de pagamento depois sem redesenho.
CREATE TABLE faturamento_mensal (
    id                          UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    tenant_id                   UUID NOT NULL REFERENCES tenants(id) ON DELETE CASCADE,
    mes_referencia               DATE NOT NULL,  -- sempre dia 1 do mês, ex.: 2026-07-01
    valor_mensalidade           NUMERIC(10,2) NOT NULL DEFAULT 0,
    valor_consultoria           NUMERIC(10,2) NOT NULL DEFAULT 0,
    valor_consumo_rcs           NUMERIC(10,2) NOT NULL DEFAULT 0,  -- RECEITA (preco_unitario × qtd) — o que cobra do tenant
    valor_consumo_whatsapp_oficial NUMERIC(10,2) NOT NULL DEFAULT 0, -- RECEITA — idem
    valor_custo_rcs              NUMERIC(10,2) NOT NULL DEFAULT 0,  -- CUSTO (custo_unitario × qtd) — o que a MKOM cobra da TUUVO
    valor_custo_whatsapp_oficial NUMERIC(10,2) NOT NULL DEFAULT 0,  -- CUSTO — idem, Meta
    lancado_por                 UUID REFERENCES tuuvo_users(id),
    criado_em                   TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE UNIQUE INDEX idx_fat_tenant_mes ON faturamento_mensal (tenant_id, mes_referencia);
CREATE INDEX idx_fat_mes ON faturamento_mensal (mes_referencia);

-- ----------------------------------------------------------------------------
-- Usuários de TENANT (login separado do time TUUVO — ver tuuvo_users acima)
-- ----------------------------------------------------------------------------

-- API Keys — pra aplicação EXTERNA do tenant integrar com canais (WhatsApp,
-- RCS, e-mail) sem depender de login humano via JWT (que expira em horas).
-- Complementa o embed de webchat (tuuvo-widget.js), que não precisa disso.
CREATE TABLE api_keys (
    id           UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    tenant_id    UUID NOT NULL REFERENCES tenants(id) ON DELETE CASCADE,
    nome         TEXT NOT NULL,          -- ex.: "Integração CRM interno"
    chave_hash   TEXT NOT NULL,          -- hash da chave (nunca guarda em texto puro — mesmo padrão de senha)
    prefixo      TEXT NOT NULL,          -- 8 primeiros chars visíveis, pra identificar qual chave é sem expor ela toda
    ultima_utilizacao TIMESTAMPTZ,
    ativo        BOOLEAN NOT NULL DEFAULT true,
    criado_em    TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE INDEX idx_api_keys_tenant ON api_keys (tenant_id);

CREATE TABLE equipes (   -- renomeado de "departments" na v1 (seção 9)
    id           UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    tenant_id    UUID NOT NULL REFERENCES tenants(id) ON DELETE CASCADE,
    nome         TEXT NOT NULL,
    horario_atendimento JSONB DEFAULT '{}',
    regras_roteamento   JSONB DEFAULT '{}',
    criado_em    TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE INDEX idx_equipes_tenant ON equipes (tenant_id);

CREATE TABLE users (
    id           UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    tenant_id    UUID NOT NULL REFERENCES tenants(id) ON DELETE CASCADE,
    email        TEXT NOT NULL,
    senha_hash   TEXT NOT NULL,
    nome         TEXT,
    papel        TEXT NOT NULL DEFAULT 'agente', -- admin | supervisor | agente
    equipe_id    UUID REFERENCES equipes(id),
    permissoes   JSONB NOT NULL DEFAULT '{}',    -- granularidade fina além do papel (seção 6)
    reset_token  TEXT,
    reset_token_expira TIMESTAMPTZ,
    status       TEXT NOT NULL DEFAULT 'ativo',
    criado_em    TIMESTAMPTZ NOT NULL DEFAULT now(),
    UNIQUE (tenant_id, email)
);
CREATE INDEX idx_users_equipe ON users (tenant_id, equipe_id);
CREATE INDEX idx_users_reset_token ON users (reset_token) WHERE reset_token IS NOT NULL;

-- ----------------------------------------------------------------------------
-- Canais (mesma estrutura da v1 — ver seção 3 pros drivers novos)
-- ----------------------------------------------------------------------------

CREATE TABLE channel_connections (
    id             UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    tenant_id      UUID NOT NULL REFERENCES tenants(id) ON DELETE CASCADE,
    tipo           TEXT NOT NULL,   -- webchat | email | whatsapp_gti | whatsapp_zernio | rcs | mobile | zernio_*
    driver         TEXT NOT NULL,   -- webchat_native | email | whatsapp_gti | zernio | mkom_rcs
    nome           TEXT NOT NULL,
    credenciais_enc      BYTEA,
    platform_provider_id UUID REFERENCES platform_channel_providers(id),
    config         JSONB NOT NULL DEFAULT '{}', -- inclui, p/ e-mail: caixa IMAP/SMTP, delimitador (seção 3.7)
    status         TEXT NOT NULL DEFAULT 'desconectado',
    ativo          BOOLEAN NOT NULL DEFAULT true,
    criado_em      TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE INDEX idx_channel_tenant_tipo ON channel_connections (tenant_id, tipo);
CREATE INDEX idx_channel_config_accountid ON channel_connections ((config->>'accountId'));
CREATE INDEX idx_channel_config_costcentre ON channel_connections ((config->>'cost_centre_id'));

CREATE TABLE equipe_channels (   -- renomeado de "department_channels"
    equipe_id             UUID NOT NULL REFERENCES equipes(id) ON DELETE CASCADE,
    channel_connection_id UUID NOT NULL REFERENCES channel_connections(id) ON DELETE CASCADE,
    padrao                BOOLEAN NOT NULL DEFAULT false,
    PRIMARY KEY (equipe_id, channel_connection_id)
);
CREATE INDEX idx_equipe_channels_reverso ON equipe_channels (channel_connection_id);

CREATE TABLE bot_widgets (
    id           UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    tenant_id    UUID NOT NULL REFERENCES tenants(id) ON DELETE CASCADE,
    nome         TEXT NOT NULL,
    config_json  JSONB NOT NULL DEFAULT '{}', -- só campos "Cliente" (seção 9) — nunca campo Kernel aqui
    versao       INT NOT NULL DEFAULT 1,
    publicado    BOOLEAN NOT NULL DEFAULT false,
    criado_em    TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE INDEX idx_widgets_tenant ON bot_widgets (tenant_id);

-- ----------------------------------------------------------------------------
-- Contatos e conversas
-- ----------------------------------------------------------------------------

CREATE TABLE contacts (
    id            UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    tenant_id     UUID NOT NULL REFERENCES tenants(id) ON DELETE CASCADE,
    nome          TEXT,
    identificador TEXT NOT NULL,
    canal_origem  TEXT,
    tipo          TEXT NOT NULL DEFAULT 'externo',  -- interno | externo (seção 6)
    metadata      JSONB DEFAULT '{}',
    criado_em     TIMESTAMPTZ NOT NULL DEFAULT now(),
    UNIQUE (tenant_id, canal_origem, identificador)
);
CREATE INDEX idx_contacts_tipo ON contacts (tenant_id, tipo);

CREATE TABLE conversations (
    id                    UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    tenant_id             UUID NOT NULL REFERENCES tenants(id) ON DELETE CASCADE,
    channel_connection_id UUID NOT NULL REFERENCES channel_connections(id),
    equipe_id             UUID REFERENCES equipes(id),
    contact_id            UUID NOT NULL REFERENCES contacts(id),
    status                TEXT NOT NULL DEFAULT 'aberta', -- aberta | em_atendimento | fechada
    atribuido_a           UUID REFERENCES users(id),
    transferida_de        UUID REFERENCES users(id),      -- histórico simples de transferência (seção 4)
    transferida_em        TIMESTAMPTZ,
    aberta_em             TIMESTAMPTZ NOT NULL DEFAULT now(),
    fechada_em            TIMESTAMPTZ
);
CREATE INDEX idx_conv_tenant_status ON conversations (tenant_id, status, aberta_em DESC);
CREATE INDEX idx_conv_contato_canal ON conversations (tenant_id, contact_id, channel_connection_id, status);
CREATE INDEX idx_conv_equipe ON conversations (tenant_id, equipe_id, status);
CREATE INDEX idx_conv_atribuido ON conversations (tenant_id, atribuido_a, status);
CREATE INDEX idx_conv_periodo ON conversations (tenant_id, aberta_em);
CREATE INDEX idx_conv_channel ON conversations (channel_connection_id);

CREATE TABLE messages (
    id                     UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    tenant_id              UUID NOT NULL REFERENCES tenants(id) ON DELETE CASCADE,
    conversation_id        UUID NOT NULL REFERENCES conversations(id) ON DELETE CASCADE,
    remetente_tipo         TEXT NOT NULL,   -- contato | agente | bot | sistema
    remetente_id           UUID,
    conteudo               TEXT,
    tipo                   TEXT NOT NULL DEFAULT 'texto', -- texto | midia | menu | nota_interna
    visivel_pro_solicitante BOOLEAN NOT NULL DEFAULT true, -- false = nota interna (seção 4)
    categoria_cobranca     TEXT,            -- whatsapp: marketing|utility|authentication|service (NULL se não aplicável)
                                             -- rcs: simples|multimidia|conversation (NULL se não aplicável)
                                             -- NULL sempre pra webchat/e-mail/GTI (não são cobrados por categoria)
    anexos                 JSONB DEFAULT '[]',             -- [{nome,url,tipo,tamanho}]
    id_externo             TEXT,            -- id da mensagem no provedor, p/ dedupe (seção 12.2)
    enviado_em             TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE INDEX idx_msg_conversation ON messages (conversation_id, enviado_em);
CREATE INDEX idx_msg_tenant_periodo ON messages (tenant_id, enviado_em);
-- Consumo mensal por categoria (seção 14.3) — soma rápida por tenant/mês/categoria
CREATE INDEX idx_msg_categoria_cobranca ON messages (tenant_id, categoria_cobranca, enviado_em)
    WHERE categoria_cobranca IS NOT NULL;
-- Dedupe de webhook "at-least-once" (MKOM/Zernio) — ver seção 12.2.
-- Ingestão deve usar INSERT ... ON CONFLICT (conversation_id, id_externo) DO NOTHING.
CREATE UNIQUE INDEX idx_msg_dedupe ON messages (conversation_id, id_externo)
    WHERE id_externo IS NOT NULL;

CREATE TABLE ai_agents (
    id            UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    tenant_id     UUID NOT NULL REFERENCES tenants(id) ON DELETE CASCADE,
    equipe_id     UUID REFERENCES equipes(id),
    provedor      TEXT NOT NULL DEFAULT 'claude',
    modelo        TEXT NOT NULL DEFAULT 'claude-sonnet-5',
    prompt_base   TEXT,
    modo          TEXT NOT NULL DEFAULT 'copiloto', -- primeira_linha | copiloto
    mcp_config    JSONB DEFAULT '{}',
    ativo         BOOLEAN NOT NULL DEFAULT false
);

CREATE TABLE audit_log (
    id         UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    tenant_id  UUID REFERENCES tenants(id) ON DELETE CASCADE,
    user_id    UUID REFERENCES users(id),
    acao       TEXT NOT NULL,
    alvo       TEXT,
    detalhes   JSONB DEFAULT '{}',
    criado_em  TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE INDEX idx_audit_tenant_data ON audit_log (tenant_id, criado_em DESC);

-- ============================================================================
-- Row-Level Security — isolamento de tenant no próprio banco (igual v1)
-- ============================================================================

CREATE OR REPLACE FUNCTION current_tenant_id() RETURNS UUID AS $$
    SELECT NULLIF(current_setting('app.current_tenant', true), '')::UUID
$$ LANGUAGE sql STABLE;

CREATE OR REPLACE FUNCTION is_superadmin() RETURNS BOOLEAN AS $$
    SELECT COALESCE(current_setting('app.is_superadmin', true), 'false')::BOOLEAN
$$ LANGUAGE sql STABLE;

DO $$
DECLARE
    t TEXT;
BEGIN
    FOR t IN SELECT unnest(ARRAY[
        'equipes', 'channel_connections', 'bot_widgets', 'api_keys',
        'contacts', 'conversations', 'messages', 'ai_agents', 'audit_log', 'users'
    ]) LOOP
        EXECUTE format('ALTER TABLE %I ENABLE ROW LEVEL SECURITY', t);
        EXECUTE format(
            'CREATE POLICY tenant_isolation ON %I
             USING (is_superadmin() OR tenant_id = current_tenant_id())
             WITH CHECK (is_superadmin() OR tenant_id = current_tenant_id())',
            t
        );
    END LOOP;
END $$;

-- tuuvo_users, planos, tenants, faturamento_mensal, platform_channel_providers
-- NÃO têm RLS de tenant — são tabelas de nível plataforma por natureza
-- (login do time TUUVO, preço público, cadastro de cliente, faturamento, credencial
-- compartilhada). Acesso a elas é controlado só pelas rotas da Administração TUUVO
-- (autenticação de tuuvo_users), não por RLS de tenant_id.

-- ============================================================================
-- Seed inicial — superadmin do time TUUVO (troque a senha no primeiro login)
-- ============================================================================

INSERT INTO tuuvo_users (email, senha_hash, nome, papel)
VALUES ('superadmin@tuuvo.app.br', '$2b$10$replace.with.a.real.bcrypt.hash.on.setup', 'Superadmin', 'superadmin');

-- Planos de exemplo, editáveis via Administração TUUVO depois
INSERT INTO planos (nome, descricao, preco, features, destaque, ordem_exibicao) VALUES
('Starter', 'Pra organizar o primeiro canal', 129.00,
 '["Webchat ou WhatsApp", "1 equipe", "Histórico de 90 dias", "Suporte por e-mail"]', false, 1),
('Professional', 'Pra quem já atende por vários canais', 349.00,
 '["WhatsApp, Webchat, e-mail e RCS", "Equipes ilimitadas", "Múltiplos atendentes em tempo real", "Widget Builder completo", "Suporte prioritário"]', true, 2),
('Agência', 'Multi-empresa numa conta só', NULL,
 '["Múltiplos ambientes isolados", "API completa + embed em outro sistema", "Redes sociais via Zernio", "Onboarding assistido"]', false, 3);

-- ============================================================================
-- Tarifas de canal — VALORES DUMMY (seção 14.5), não reais. Servem pra
-- testar a estrutura inteira (medição → cálculo → faturamento) de ponta a
-- ponta antes dos números de verdade chegarem. Trocar em `custo_unitario`
-- quando a Meta/MKOM confirmarem; `preco_unitario` é decisão da Administração
-- TUUVO, pode ser editado a qualquer momento pela tela de Planos/Tarifas,
-- independente do custo.
--
-- Custo dummy = uma estimativa arredondada, só pra a conta não sair R$0,00
-- e a demonstração fazer sentido. Preço dummy = custo × ~2,5, um markup
-- ilustrativo — não é recomendação de margem, é só pra ter número diferente
-- de custo e mostrar a separação funcionando.
-- ============================================================================
INSERT INTO tarifas_canal (canal, categoria, pais, custo_unitario, preco_unitario, fonte_custo) VALUES
('whatsapp_oficial', 'marketing',      'BR', 0.3500, 0.9000, 'DUMMY — confirmar no rate card oficial da Meta (CSV BRL)'),
('whatsapp_oficial', 'utility',        'BR', 0.0400, 0.1000, 'DUMMY — confirmar no rate card oficial da Meta (CSV BRL)'),
('whatsapp_oficial', 'authentication', 'BR', 0.1500, 0.4000, 'DUMMY — confirmar no rate card oficial da Meta (CSV BRL)'),
('whatsapp_oficial', 'service',        'BR', 0.0350, 0.0900, 'DUMMY — cobrança inicia 01/10/2026, confirmar valor publicado até 01/09/2026'),
('rcs', 'simples',      'BR', 0.0900, 0.2200, 'DUMMY — aguardando valor real da MKOM'),
('rcs', 'multimidia',   'BR', 0.1300, 0.3200, 'DUMMY — aguardando valor real da MKOM'),
('rcs', 'conversation', 'BR', 0.1500, 0.3700, 'DUMMY — aguardando valor real da MKOM');
