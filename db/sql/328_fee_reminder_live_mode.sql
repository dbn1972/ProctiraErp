-- PRC-L291: the fee reminder send audit can record a real (live) send.
--
-- 058 created fee_reminder_send_audits with CHECK (mode = 'sandbox'), so a
-- send through a real messaging provider could never be audited. DR50 (owner
-- rule, 2026-10-27) picks MSG91 for SMS and Amazon SES for email, built against
-- stubbed providers first, credentials only in the secret manager.
--
-- Fix:
--   1. provider and provider_message_id columns (nullable).
--   2. The mode CHECK becomes: mode IN ('sandbox', 'live'); a sandbox row has
--      no provider; a live row names the provider that matches its channel
--      (sms -> msg91, email -> ses) and the id that provider returned.
--      So "live" can only be written together with real provider evidence,
--      which keeps 058's honesty guard: a sandbox send cannot be dressed up
--      as live.
--
-- Existing rows are all mode = 'sandbox' with no provider, so the new CHECK
-- holds for them; it is added NOT VALID and VALIDATEd with FORCE ROW LEVEL
-- SECURITY lifted and restored in this transaction.
--
-- Rollback (forward migration): drop the new CHECK, re-add
-- CHECK (mode = 'sandbox'), drop the two columns.
ALTER TABLE fee_reminder_send_audits ADD COLUMN IF NOT EXISTS provider TEXT;
ALTER TABLE fee_reminder_send_audits ADD COLUMN IF NOT EXISTS provider_message_id TEXT;
ALTER TABLE fee_reminder_send_audits DROP CONSTRAINT IF EXISTS fee_reminder_send_audits_mode_check;
ALTER TABLE fee_reminder_send_audits DROP CONSTRAINT IF EXISTS fee_reminder_send_audits_mode_provider_chk;
ALTER TABLE fee_reminder_send_audits
  ADD CONSTRAINT fee_reminder_send_audits_mode_provider_chk
  CHECK (
    (mode = 'sandbox' AND provider IS NULL AND provider_message_id IS NULL)
    OR (
      mode = 'live'
      AND provider_message_id IS NOT NULL
      AND length(trim(provider_message_id)) > 0
      AND (
        (channel = 'sms' AND provider = 'msg91')
        OR (channel = 'email' AND provider = 'ses')
      )
    )
  ) NOT VALID;
DO $l291$
DECLARE
  was_forced boolean;
BEGIN
  SELECT relforcerowsecurity INTO was_forced
    FROM pg_class WHERE oid = 'public.fee_reminder_send_audits'::regclass;
  IF was_forced THEN
    ALTER TABLE fee_reminder_send_audits NO FORCE ROW LEVEL SECURITY;
  END IF;
  ALTER TABLE fee_reminder_send_audits
    VALIDATE CONSTRAINT fee_reminder_send_audits_mode_provider_chk;
  IF was_forced THEN
    ALTER TABLE fee_reminder_send_audits FORCE ROW LEVEL SECURITY;
  END IF;
END
$l291$;
INSERT INTO schema_migrations (filename)
VALUES ('328_fee_reminder_live_mode.sql')
ON CONFLICT (filename) DO NOTHING;
