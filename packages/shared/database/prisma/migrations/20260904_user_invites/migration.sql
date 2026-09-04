-- Admin user invites (auth schema). Bare UUID tenant/role/invited_by refs.

CREATE EXTENSION IF NOT EXISTS "uuid-ossp";

CREATE TABLE IF NOT EXISTS auth.user_invites (
    "id"           UUID         NOT NULL DEFAULT uuid_generate_v4(),
    "tenant_id"    UUID         NOT NULL,
    "email"        VARCHAR(255) NOT NULL,
    "display_name" VARCHAR(255),
    "role_id"      UUID,
    "token"        VARCHAR(128) NOT NULL,
    "status"       VARCHAR(20)  NOT NULL DEFAULT 'pending',
    "invited_by"   UUID,
    "expires_at"   TIMESTAMPTZ  NOT NULL,
    "accepted_at"  TIMESTAMPTZ,
    "created_at"   TIMESTAMPTZ  NOT NULL DEFAULT NOW(),
    "updated_at"   TIMESTAMPTZ  NOT NULL DEFAULT NOW(),

    CONSTRAINT "user_invites_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX IF NOT EXISTS "user_invites_tenant_token_key"
    ON auth.user_invites ("tenant_id", "token");
CREATE INDEX IF NOT EXISTS "user_invites_tenant_email_idx"
    ON auth.user_invites ("tenant_id", "email");
CREATE INDEX IF NOT EXISTS "user_invites_tenant_status_idx"
    ON auth.user_invites ("tenant_id", "status");
