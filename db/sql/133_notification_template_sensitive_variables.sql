-- g7_platform-004: sensitive notification template variable classification.
--
-- Notification variables routinely carry password-reset links, OTPs, verification codes and
-- bearer tokens. The service now redacts sensitive variable values before persisting a
-- notification record (and therefore before the inbox/status APIs can return them). A built-in
-- denylist of common sensitive key-name patterns always applies; these two optional, additive
-- columns let a tenant admin declare an explicit per-template allowlist (sensitive_variables)
-- and an explicit opt-out (public_variables), so classification is deterministic and durable.
--
-- Additive and idempotent (ADD COLUMN IF NOT EXISTS); the notification_templates table and its
-- tenant_isolation RLS policy are unchanged (db/sql/131). Forward-only; apply-sql.sh ledger
-- records completion.

ALTER TABLE notification_templates
  ADD COLUMN IF NOT EXISTS sensitive_variables JSONB NOT NULL DEFAULT '[]'::jsonb;

ALTER TABLE notification_templates
  ADD COLUMN IF NOT EXISTS public_variables JSONB NOT NULL DEFAULT '[]'::jsonb;
