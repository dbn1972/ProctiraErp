-- PRC-L295: audit log retention has no statutory floor at the DB layer.
--
-- audit_retention_configs.retention_months only had `CHECK (retention_months
-- > 0)` (db/sql/022), so a tenant could configure a 1-month audit-log
-- retention. docs/audits/remediation/decisions/D5-privacy-retention.md fixes
-- the floor at 24 months default / 12 months minimum for audit logs; this
-- migration raises the DB CHECK to match (the app-layer floor in
-- packages/backend/audit/src/audit-service.ts's setRetentionConfig is raised
-- to the same 12 in the same change, so the API rejects before the DB would).
--
-- Data safety: dropped and re-added NOT VALID (new writes checked
-- immediately); existing rows are then validated with FORCE ROW LEVEL
-- SECURITY lifted for the scan and restored in the same transaction
-- (audit_retention_configs is confirmed relforcerowsecurity=true -- see
-- db/sql/114's pattern, which this mirrors). If any existing row holds
-- retention_months < 12, the constraint is left NOT VALID with a RAISE
-- WARNING naming the count instead of failing the deploy or silently
-- bumping tenant data. Live preflight on this worktree's shared Postgres
-- found 0 such rows.

ALTER TABLE audit_retention_configs
  DROP CONSTRAINT IF EXISTS audit_retention_configs_retention_months_check;
ALTER TABLE audit_retention_configs
  ADD CONSTRAINT audit_retention_configs_retention_months_check
  CHECK (retention_months >= 12) NOT VALID;

DO $prc_l295_validate$
DECLARE
  was_forced boolean;
  bad_rows bigint;
BEGIN
  SELECT relforcerowsecurity INTO was_forced
    FROM pg_class WHERE oid = 'public.audit_retention_configs'::regclass;
  IF was_forced THEN
    ALTER TABLE audit_retention_configs NO FORCE ROW LEVEL SECURITY;
  END IF;

  SELECT count(*) INTO bad_rows
    FROM audit_retention_configs
   WHERE retention_months < 12;

  IF bad_rows = 0 THEN
    ALTER TABLE audit_retention_configs
      VALIDATE CONSTRAINT audit_retention_configs_retention_months_check;
  ELSE
    RAISE WARNING
      'PRC-L295: % audit_retention_configs row(s) have retention_months below '
      'the 12-month floor; audit_retention_configs_retention_months_check left '
      'NOT VALID (new writes are still checked). Correct those rows, then '
      'VALIDATE CONSTRAINT audit_retention_configs_retention_months_check.',
      bad_rows;
  END IF;

  IF was_forced THEN
    ALTER TABLE audit_retention_configs FORCE ROW LEVEL SECURITY;
  END IF;
END
$prc_l295_validate$;

INSERT INTO schema_migrations (filename)
VALUES ('243_audit_retention_floor.sql')
ON CONFLICT (filename) DO NOTHING;
