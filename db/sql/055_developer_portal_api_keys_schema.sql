-- W1-ARCH-01 (C3): durable developer-portal API keys (hashed at rest, tenant-scoped).
--
-- Raw secrets are never stored; only sha256-prefixed digests from P0-11 hashApiKey().
-- validate-key lookups use platform scope against the global key_hash unique index.

CREATE TABLE IF NOT EXISTS developer_portal_api_keys (
  id           UUID PRIMARY KEY,
  tenant_id    UUID NOT NULL,
  account_id   UUID NOT NULL,
  name         TEXT NOT NULL,
  key_hash     TEXT NOT NULL,
  key_prefix   TEXT NOT NULL,
  scopes       JSONB NOT NULL DEFAULT '[]'::jsonb,
  status       TEXT NOT NULL DEFAULT 'active'
               CHECK (status IN ('active', 'revoked', 'expired')),
  expires_at   TIMESTAMPTZ,
  last_used_at TIMESTAMPTZ,
  created_at   TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE UNIQUE INDEX IF NOT EXISTS developer_portal_api_keys_key_hash_uidx
  ON developer_portal_api_keys (key_hash);

CREATE INDEX IF NOT EXISTS developer_portal_api_keys_tenant_account_idx
  ON developer_portal_api_keys (tenant_id, account_id, status);

ALTER TABLE developer_portal_api_keys ENABLE ROW LEVEL SECURITY;
ALTER TABLE developer_portal_api_keys FORCE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS tenant_isolation ON developer_portal_api_keys;
CREATE POLICY tenant_isolation ON developer_portal_api_keys
  FOR ALL
  USING (tenant_id::text = NULLIF(current_setting('app.tenant_id', true), ''))
  WITH CHECK (tenant_id::text = NULLIF(current_setting('app.tenant_id', true), ''));
