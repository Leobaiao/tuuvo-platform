-- ============================================================================
-- TUUVO Conversation Platform — Schema Postgres
-- Multi-tenant via tenant_id + Row-Level Security (RLS)
-- Referência: TUUVO_Arquitetura_Tecnica.md, seções 3, 4, 5
-- ============================================================================

CREATE EXTENSION IF NOT EXISTS "pgcrypto";

-- ----------------------------------------------------------------------------
-- Plataforma (fora do escopo de tenant)
-- ----------------------------------------------------------------------------

CREATE TABLE tenants (
    id              UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    nome            TEXT NOT NULL,
    slug            TEXT UNIQUE NOT NULL,
    plano           TEXT NOT NULL DEFAULT 'trial', -- trial | starter | pro | enterprise
    status          TEXT NOT NULL DEFAULT 'ativo',  -- ativo | suspenso | cancelado
    limites         JSONB NOT NULL DEFAULT '{"max_conexoes": 3, "max_agentes": 5}',
    trial_expira_em TIMESTAMPTZ,
    criado_em       TIMESTAMPTZ NOT NULL DEFAULT now()
);

-- Credenciais de brokers a nível de plataforma (SMS/RCS via MKOM, Voz futuramente)
-- Não é por tenant — ver seção 5/6.4/6.5 da especificação.
CREATE TABLE platform_channel_providers (
    id              UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    tipo            TEXT NOT NULL,              -- sms | rcs | voz | zernio
    nome            TEXT NOT NULL,              -- ex.: "MKOM - MKSMS", "Zernio"
    endpoint_base   TEXT NOT NULL,
    credenciais_enc BYTEA NOT NULL,             -- token cifrado (ver utils/crypto.ts)
    config          JSONB NOT NULL DEFAULT '{}', -- rate limit, ips liberados, etc.
    ativo           BOOLEAN NOT NULL DEFAULT true,
    criado_em       TIMESTAMPTZ NOT NULL DEFAULT now()
);

-- ----------------------------------------------------------------------------
-- Usuários (superadmin fica com tenant_id = NULL)
-- ----------------------------------------------------------------------------

CREATE TABLE users (
    id           UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    tenant_id    UUID REFERENCES tenants(id) ON DELETE CASCADE,
    email        TEXT NOT NULL,
    senha_hash   TEXT NOT NULL,
    nome         TEXT,
    papel        TEXT NOT NULL DEFAULT 'agente', -- superadmin | admin | supervisor | agente
    status       TEXT NOT NULL DEFAULT 'ativo',
    criado_em    TIMESTAMPTZ NOT NULL DEFAULT now(),
    UNIQUE (tenant_id, email)
);
CREATE UNIQUE INDEX users_superadmin_email ON users (email) WHERE tenant_id IS NULL;

-- ----------------------------------------------------------------------------
-- Tabelas por tenant (todas levam tenant_id + RLS)
-- ----------------------------------------------------------------------------

CREATE TABLE departments (
    id                UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    tenant_id         UUID NOT NULL REFERENCES tenants(id) ON DELETE CASCADE,
    nome              TEXT NOT NULL,
    horario_atendimento JSONB DEFAULT '{}',   -- {"seg": ["09:00","18:00"], ...}
    regras_roteamento  JSONB DEFAULT '{}',    -- keywords, menu de opções, round-robin/fila
    criado_em         TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE TABLE channel_connections (
    id             UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    tenant_id      UUID NOT NULL REFERENCES tenants(id) ON DELETE CASCADE,
    tipo           TEXT NOT NULL,   -- webchat | whatsapp | sms | rcs | voz | zernio_*
    driver         TEXT NOT NULL,   -- webchat_native | whatsapp_gti | mkom_sms | mkom_rcs | zernio
    nome           TEXT NOT NULL,   -- nome amigável exibido no painel
    -- para WhatsApp/GTI: token da instância cifrado. Para SMS/RCS: referencia o provider da plataforma.
    credenciais_enc      BYTEA,
    platform_provider_id UUID REFERENCES platform_channel_providers(id),
    config         JSONB NOT NULL DEFAULT '{}', -- sender_id, domínios autorizados (webchat), etc.
    status         TEXT NOT NULL DEFAULT 'desconectado', -- desconectado | qr_pending | conectado
    ativo          BOOLEAN NOT NULL DEFAULT true,
    criado_em      TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE TABLE department_channels (
    department_id        UUID NOT NULL REFERENCES departments(id) ON DELETE CASCADE,
    channel_connection_id UUID NOT NULL REFERENCES channel_connections(id) ON DELETE CASCADE,
    padrao                BOOLEAN NOT NULL DEFAULT false, -- departamento padrão da conexão
    PRIMARY KEY (department_id, channel_connection_id)
);

CREATE TABLE bot_widgets (
    id           UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    tenant_id    UUID NOT NULL REFERENCES tenants(id) ON DELETE CASCADE,
    nome         TEXT NOT NULL,
    config_json  JSONB NOT NULL DEFAULT '{}', -- ver seção 8 da especificação (cores, header, dimensões...)
    versao       INT NOT NULL DEFAULT 1,
    publicado    BOOLEAN NOT NULL DEFAULT false,
    criado_em    TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE TABLE contacts (
    id           UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    tenant_id    UUID NOT NULL REFERENCES tenants(id) ON DELETE CASCADE,
    nome         TEXT,
    identificador TEXT NOT NULL, -- telefone, e-mail, ou id externo, conforme o canal
    canal_origem TEXT,
    metadata     JSONB DEFAULT '{}',
    criado_em    TIMESTAMPTZ NOT NULL DEFAULT now(),
    UNIQUE (tenant_id, canal_origem, identificador)
);

CREATE TABLE conversations (
    id                    UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    tenant_id             UUID NOT NULL REFERENCES tenants(id) ON DELETE CASCADE,
    channel_connection_id UUID NOT NULL REFERENCES channel_connections(id),
    department_id         UUID REFERENCES departments(id),
    contact_id            UUID NOT NULL REFERENCES contacts(id),
    status                TEXT NOT NULL DEFAULT 'aberta', -- aberta | em_atendimento | fechada
    atribuido_a           UUID REFERENCES users(id),
    aberta_em             TIMESTAMPTZ NOT NULL DEFAULT now(),
    fechada_em            TIMESTAMPTZ
);

CREATE TABLE messages (
    id              UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    tenant_id       UUID NOT NULL REFERENCES tenants(id) ON DELETE CASCADE,
    conversation_id UUID NOT NULL REFERENCES conversations(id) ON DELETE CASCADE,
    remetente_tipo  TEXT NOT NULL,   -- contato | agente | bot | sistema
    remetente_id    UUID,
    conteudo        TEXT,
    tipo            TEXT NOT NULL DEFAULT 'texto', -- texto | midia | menu | localizacao | ...
    anexos          JSONB DEFAULT '[]',
    id_externo       TEXT,            -- id da mensagem no provedor (GTI/MKOM), pra idempotência
    enviado_em      TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE TABLE ai_agents (
    id           UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    tenant_id    UUID NOT NULL REFERENCES tenants(id) ON DELETE CASCADE,
    department_id UUID REFERENCES departments(id),
    provedor     TEXT NOT NULL DEFAULT 'claude',
    modelo       TEXT NOT NULL DEFAULT 'claude-sonnet-5',
    prompt_base  TEXT,
    modo         TEXT NOT NULL DEFAULT 'copiloto', -- primeira_linha | copiloto
    mcp_config   JSONB DEFAULT '{}',
    ativo        BOOLEAN NOT NULL DEFAULT false
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

-- ============================================================================
-- Row-Level Security — isolamento de tenant no próprio banco
-- A aplicação define `SET app.current_tenant = '<uuid>'` por conexão/request.
-- Superadmin usa `SET app.is_superadmin = 'true'` para enxergar tudo.
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
        'departments', 'channel_connections', 'bot_widgets',
        'contacts', 'conversations', 'messages', 'ai_agents', 'audit_log'
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

-- users tem regra própria (superadmin não tem tenant_id, mas outros usuários sim)
ALTER TABLE users ENABLE ROW LEVEL SECURITY;
CREATE POLICY users_isolation ON users
    USING (is_superadmin() OR tenant_id = current_tenant_id())
    WITH CHECK (is_superadmin() OR tenant_id = current_tenant_id());

-- department_channels segue via join implícito (não tem tenant_id direto) — RLS aplicada
-- na camada de aplicação (join sempre passa por channel_connections/departments, que já têm RLS).

-- ============================================================================
-- Índices de apoio
-- ============================================================================

CREATE INDEX idx_conversations_tenant_status ON conversations (tenant_id, status);
CREATE INDEX idx_messages_conversation ON messages (conversation_id, enviado_em);
CREATE INDEX idx_channel_connections_tenant ON channel_connections (tenant_id, tipo);
CREATE INDEX idx_contacts_tenant_ident ON contacts (tenant_id, identificador);

-- ============================================================================
-- Seed inicial — superadmin (troque a senha no primeiro login)
-- Senha do seed: "TuuvoAdmin123!" (hash bcrypt gerado só como placeholder de exemplo)
-- ============================================================================

INSERT INTO users (tenant_id, email, senha_hash, nome, papel)
VALUES (NULL, 'superadmin@tuuvo.app.br', '$2a$10$vLtb/3U.qkbAt1fisPVNzufE4ijPqBySRNmK6IND.H5e5PShHV4u2', 'Superadmin', 'superadmin');
