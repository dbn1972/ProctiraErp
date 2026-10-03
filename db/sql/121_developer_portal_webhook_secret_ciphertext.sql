-- PRC-M211 — developer-portal webhook signing secrets sealed at rest.
--
-- 089 stored only secret_hash, but a webhook secret is the HMAC key the delivery
-- worker signs with, so a hash cannot be used. The service now stores an
-- AES-256-GCM sealed copy (WEBHOOK_SECRET_ENCRYPTION_KEY, AAD = tenant + webhook
-- id) in secret_ciphertext and the worker decrypts it from the row; the secret no
-- longer travels in queue messages. Legacy rows keep NULL and their deliveries
-- fail closed until the owner rotates the secret (PATCH with a new secret).
--
-- Additive / idempotent. RLS (ENABLE + FORCE, tenant_isolation) and table grants
-- from 089 already cover the new column; re-asserted below. Needs DB review.

ALTER TABLE developer_portal_webhooks
  ADD COLUMN IF NOT EXISTS secret_ciphertext TEXT;

ALTER TABLE developer_portal_webhooks ENABLE ROW LEVEL SECURITY;
ALTER TABLE developer_portal_webhooks FORCE ROW LEVEL SECURITY;

DO $$
BEGIN
  IF EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'proctira_app') THEN
    GRANT SELECT, INSERT, UPDATE, DELETE ON developer_portal_webhooks TO proctira_app;
  END IF;
END $$;

INSERT INTO schema_migrations (filename)
VALUES ('121_developer_portal_webhook_secret_ciphertext.sql')
ON CONFLICT (filename) DO NOTHING;
