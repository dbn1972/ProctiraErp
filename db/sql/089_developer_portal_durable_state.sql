-- W1-ARCH-01 COMPLETE: durable developer-portal security-critical state.
--
-- Extends 055 (API keys) with accounts, webhooks (secret digests), and
-- webhook delivery rows. Marketplace/docs/analytics/sandboxes remain
-- in-memory residuals (non-security-critical catalog surfaces).
--
-- Secrets: webhook secret_hash only (raw secret never stored) — same posture
-- as API key hashes in 055 / P0-11.

CREATE TABLE IF NOT EXISTS developer_portal_accounts (
  id           UUID PRIMARY KEY,
  name         TEXT NOT NULL,
  email        TEXT NOT NULL,
  organization TEXT,
  website      TEXT,
  status       TEXT NOT NULL DEFAULT 'active'
               CHECK (status IN ('active', 'suspended', 'deactivated')),
  created_at   TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at   TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE UNIQUE INDEX IF NOT EXISTS developer_portal_accounts_email_uidx
  ON developer_portal_accounts (lower(email));

-- Platform-scoped (no tenant_id): account CRUD uses withPlatformScope.
ALTER TABLE developer_portal_accounts ENABLE ROW LEVEL SECURITY;
ALTER TABLE developer_portal_accounts FORCE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS platform_admin_only ON developer_portal_accounts;
CREATE POLICY platform_admin_only ON developer_portal_accounts
  FOR ALL
  USING (current_setting('app.platform_admin', true) = '1')
  WITH CHECK (current_setting('app.platform_admin', true) = '1');

CREATE TABLE IF NOT EXISTS developer_portal_webhooks (
  id           UUID PRIMARY KEY,
  tenant_id    UUID NOT NULL,
  account_id   UUID NOT NULL,
  url          TEXT NOT NULL,
  events       JSONB NOT NULL DEFAULT '[]'::jsonb,
  secret_hash  TEXT NOT NULL,
  description  TEXT,
  active       BOOLEAN NOT NULL DEFAULT TRUE,
  created_at   TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at   TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS developer_portal_webhooks_tenant_account_idx
  ON developer_portal_webhooks (tenant_id, account_id, active);

ALTER TABLE developer_portal_webhooks ENABLE ROW LEVEL SECURITY;
ALTER TABLE developer_portal_webhooks FORCE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS tenant_isolation ON developer_portal_webhooks;
CREATE POLICY tenant_isolation ON developer_portal_webhooks
  FOR ALL
  USING (tenant_id::text = NULLIF(current_setting('app.tenant_id', true), ''))
  WITH CHECK (tenant_id::text = NULLIF(current_setting('app.tenant_id', true), ''));

CREATE TABLE IF NOT EXISTS developer_portal_webhook_deliveries (
  id              UUID PRIMARY KEY,
  tenant_id       UUID NOT NULL,
  webhook_id      UUID NOT NULL,
  event           TEXT NOT NULL,
  payload         JSONB NOT NULL DEFAULT '{}'::jsonb,
  status          TEXT NOT NULL DEFAULT 'pending'
                  CHECK (status IN ('pending', 'delivered', 'failed')),
  http_status     INT,
  attempts        INT NOT NULL DEFAULT 0,
  last_attempt_at TIMESTAMPTZ,
  next_retry_at   TIMESTAMPTZ,
  created_at      TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS developer_portal_webhook_deliveries_webhook_idx
  ON developer_portal_webhook_deliveries (tenant_id, webhook_id, status, created_at DESC);

ALTER TABLE developer_portal_webhook_deliveries ENABLE ROW LEVEL SECURITY;
ALTER TABLE developer_portal_webhook_deliveries FORCE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS tenant_isolation ON developer_portal_webhook_deliveries;
CREATE POLICY tenant_isolation ON developer_portal_webhook_deliveries
  FOR ALL
  USING (tenant_id::text = NULLIF(current_setting('app.tenant_id', true), ''))
  WITH CHECK (tenant_id::text = NULLIF(current_setting('app.tenant_id', true), ''));
