-- PRC-H046: envelope-encrypted webhook signing secrets.
--
-- developer_portal_webhooks stores only secret_hash (one-way), so outbound
-- deliveries cannot be HMAC-signed with the subscriber's secret. This table
-- holds the secret envelope-encrypted, never in plaintext:
--   * a per-secret data key (DEK) encrypts the secret with AES-256-GCM
--     -> ciphertext + 12-byte nonce + 16-byte auth tag
--   * the DEK is wrapped by a KMS key -> wrapped_data_key + kms_key_ref
-- The database never sees the DEK or the secret. There is deliberately no
-- plaintext column, and the CHECKs below pin the AEAD shape so a raw secret
-- cannot be written into ciphertext by mistake without also faking nonce/tag.
-- secret_hash on developer_portal_webhooks remains the verification hash.
--
-- One active secret per webhook (rotation: insert the next key_version, mark the
-- previous one 'retired' — retired rows stay for in-flight retry signing).
--
-- Non-transactional file: the composite (tenant_id, id) unique index on the
-- existing webhooks table is built online so the tenant-bound FK below can
-- reference it. Every statement is idempotent (apply-sql.sh phase ledger).
-- Rollback: forward-only. Dropping the table makes deliveries unsignable again.

-- 1) Retry-safe online build of the FK target on the existing table.
DO $h046_drop_invalid$
BEGIN
  IF EXISTS (
    SELECT 1
      FROM pg_class c
      JOIN pg_namespace n ON n.oid = c.relnamespace
      JOIN pg_index i ON i.indexrelid = c.oid
     WHERE n.nspname = 'public'
       AND c.relname = 'developer_portal_webhooks_tenant_id_uidx'
       AND NOT i.indisvalid
  ) THEN
    EXECUTE 'DROP INDEX IF EXISTS public.developer_portal_webhooks_tenant_id_uidx';
  END IF;
END
$h046_drop_invalid$;

CREATE UNIQUE INDEX CONCURRENTLY IF NOT EXISTS developer_portal_webhooks_tenant_id_uidx
  ON developer_portal_webhooks (tenant_id, id);

DO $h046_assert_uidx$
BEGIN
  IF NOT EXISTS (
    SELECT 1
      FROM pg_class c
      JOIN pg_namespace n ON n.oid = c.relnamespace
      JOIN pg_index i ON i.indexrelid = c.oid
     WHERE n.nspname = 'public'
       AND c.relname = 'developer_portal_webhooks_tenant_id_uidx'
       AND i.indisvalid
  ) THEN
    RAISE EXCEPTION 'PRC-H046: developer_portal_webhooks_tenant_id_uidx missing or INVALID';
  END IF;
END
$h046_assert_uidx$;

-- 2) The secret envelope store (new, empty table).
CREATE TABLE IF NOT EXISTS developer_portal_webhook_signing_secrets (
  id UUID PRIMARY KEY,
  tenant_id UUID NOT NULL REFERENCES tenants(id),
  webhook_id UUID NOT NULL,
  key_version INTEGER NOT NULL CHECK (key_version >= 1),
  algorithm TEXT NOT NULL DEFAULT 'AES-256-GCM' CHECK (algorithm IN ('AES-256-GCM')),
  ciphertext BYTEA NOT NULL CHECK (octet_length(ciphertext) BETWEEN 16 AND 1024),
  nonce BYTEA NOT NULL CHECK (octet_length(nonce) = 12),
  auth_tag BYTEA NOT NULL CHECK (octet_length(auth_tag) = 16),
  wrapped_data_key BYTEA NOT NULL CHECK (octet_length(wrapped_data_key) BETWEEN 16 AND 2048),
  kms_key_ref TEXT NOT NULL CHECK (length(btrim(kms_key_ref)) BETWEEN 1 AND 512),
  status TEXT NOT NULL DEFAULT 'active' CHECK (status IN ('active', 'retired')),
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  retired_at TIMESTAMPTZ,
  CONSTRAINT developer_portal_webhook_signing_secrets_webhook_fk
    FOREIGN KEY (tenant_id, webhook_id)
    REFERENCES developer_portal_webhooks (tenant_id, id)
    ON DELETE CASCADE,
  CONSTRAINT developer_portal_webhook_signing_secrets_version_uq
    UNIQUE (tenant_id, webhook_id, key_version),
  CONSTRAINT developer_portal_webhook_signing_secrets_retired_ck
    CHECK ((status = 'retired') = (retired_at IS NOT NULL))
);

-- At most one active signing secret per webhook.
CREATE UNIQUE INDEX IF NOT EXISTS developer_portal_webhook_signing_secrets_active_uidx
  ON developer_portal_webhook_signing_secrets (tenant_id, webhook_id)
  WHERE status = 'active';

ALTER TABLE developer_portal_webhook_signing_secrets ENABLE ROW LEVEL SECURITY;
ALTER TABLE developer_portal_webhook_signing_secrets FORCE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS tenant_isolation ON developer_portal_webhook_signing_secrets;
CREATE POLICY tenant_isolation ON developer_portal_webhook_signing_secrets
  FOR ALL
  USING (tenant_id::text = NULLIF(current_setting('app.tenant_id', true), ''))
  WITH CHECK (tenant_id::text = NULLIF(current_setting('app.tenant_id', true), ''));

COMMENT ON TABLE developer_portal_webhook_signing_secrets IS
  'PRC-H046 envelope-encrypted webhook signing secrets (AES-256-GCM, KMS-wrapped DEK). Never plaintext.';
COMMENT ON COLUMN developer_portal_webhook_signing_secrets.kms_key_ref IS
  'KMS key id/alias/ARN that wrapped the data key. A reference only, never key material.';

DO $h046_grant$
BEGIN
  IF EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'proctira_app') THEN
    GRANT SELECT, INSERT, UPDATE, DELETE
      ON TABLE developer_portal_webhook_signing_secrets TO proctira_app;
  END IF;
END
$h046_grant$;
