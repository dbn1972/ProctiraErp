-- W1-DATA-03: RefreshToken / UserSession executable SQL tables.
--
-- Prisma models RefreshToken and UserSession (@@map refresh_tokens / user_sessions)
-- existed in packages/shared/database/prisma/schema.prisma without a Prisma migration
-- or numbered db/sql file. Fresh apply-sql / migrate deploys therefore had no tables,
-- so durable session/refresh-token persistence could not land on Postgres.
--
-- Column names mirror Prisma @map()s. RLS follows 015/021/055: tenant_isolation on
-- app.tenant_id, FORCE so the table owner cannot bypass.

CREATE TABLE IF NOT EXISTS user_sessions (
  id               UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  user_id          UUID NOT NULL,
  tenant_id        UUID NOT NULL REFERENCES tenants(id),
  created_at       TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  expires_at       TIMESTAMPTZ NOT NULL,
  last_activity_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  is_active        BOOLEAN NOT NULL DEFAULT TRUE,
  user_agent       VARCHAR(500),
  ip_address       VARCHAR(45),
  invalidated_at   TIMESTAMPTZ
);

CREATE INDEX IF NOT EXISTS user_sessions_tenant_id_user_id_idx
  ON user_sessions (tenant_id, user_id);
CREATE INDEX IF NOT EXISTS user_sessions_tenant_id_is_active_idx
  ON user_sessions (tenant_id, is_active);
CREATE INDEX IF NOT EXISTS user_sessions_expires_at_idx
  ON user_sessions (expires_at);

CREATE TABLE IF NOT EXISTS refresh_tokens (
  id                UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  token             VARCHAR(255) NOT NULL,
  user_id           UUID NOT NULL,
  tenant_id         UUID NOT NULL REFERENCES tenants(id),
  session_id        UUID NOT NULL REFERENCES user_sessions(id) ON DELETE CASCADE,
  expires_at        TIMESTAMPTZ NOT NULL,
  revoked           BOOLEAN NOT NULL DEFAULT FALSE,
  revoked_at        TIMESTAMPTZ,
  revoked_reason    VARCHAR(255),
  replaced_by_token VARCHAR(255),
  created_by_ip     VARCHAR(45),
  created_at        TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  CONSTRAINT refresh_tokens_token_key UNIQUE (token)
);

CREATE INDEX IF NOT EXISTS refresh_tokens_tenant_id_user_id_idx
  ON refresh_tokens (tenant_id, user_id);
CREATE INDEX IF NOT EXISTS refresh_tokens_tenant_id_session_id_idx
  ON refresh_tokens (tenant_id, session_id);
CREATE INDEX IF NOT EXISTS refresh_tokens_expires_at_idx
  ON refresh_tokens (expires_at);
CREATE INDEX IF NOT EXISTS refresh_tokens_revoked_idx
  ON refresh_tokens (revoked);

ALTER TABLE user_sessions ENABLE ROW LEVEL SECURITY;
ALTER TABLE user_sessions FORCE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS tenant_isolation ON user_sessions;
CREATE POLICY tenant_isolation ON user_sessions
  FOR ALL
  USING (tenant_id::text = NULLIF(current_setting('app.tenant_id', true), ''))
  WITH CHECK (tenant_id::text = NULLIF(current_setting('app.tenant_id', true), ''));

ALTER TABLE refresh_tokens ENABLE ROW LEVEL SECURITY;
ALTER TABLE refresh_tokens FORCE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS tenant_isolation ON refresh_tokens;
CREATE POLICY tenant_isolation ON refresh_tokens
  FOR ALL
  USING (tenant_id::text = NULLIF(current_setting('app.tenant_id', true), ''))
  WITH CHECK (tenant_id::text = NULLIF(current_setting('app.tenant_id', true), ''));
