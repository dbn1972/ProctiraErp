-- PRC-M318: additive columns so a guardian's withdrawal reason and the
-- channel/method a consent decision was recorded via survive past the
-- withdrawConsent call instead of being silently dropped on the floor.
--
-- Plain nullable ADD COLUMN, no backfill, no CHECK/FK/index — the light
-- pattern used by 090_consent_lifecycle_append_only.sql's own
-- `ADD COLUMN IF NOT EXISTS` lines, not the heavy NOT VALID+VALIDATE dance
-- (that is only required for CHECK/FK/index additions on existing data).
--
-- Gates on table existence so domain ensureSchema helpers can apply this file
-- independently.
DO $$
BEGIN
  IF to_regclass('public.parent_consents') IS NULL THEN
    RETURN;
  END IF;

  ALTER TABLE parent_consents ADD COLUMN IF NOT EXISTS withdrawal_reason TEXT;
  ALTER TABLE parent_consents ADD COLUMN IF NOT EXISTS decided_via TEXT;
END $$;

COMMENT ON COLUMN parent_consents.withdrawal_reason IS
  'PRC-M318: free-text reason the guardian gave on withdrawConsent; NULL when not supplied or not a withdrawal.';
COMMENT ON COLUMN parent_consents.decided_via IS
  'PRC-M318: channel/method a consent decision (decide/withdraw) was recorded via (e.g. portal, paper); NULL when not supplied.';

DO $$
BEGIN
  IF to_regclass('public.schema_migrations') IS NOT NULL THEN
    INSERT INTO schema_migrations (filename)
    VALUES ('290_parent_consent_withdrawal_reason.sql')
    ON CONFLICT DO NOTHING;
  END IF;
END $$;
