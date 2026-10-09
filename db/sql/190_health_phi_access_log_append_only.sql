-- PRC-M199 / PRC-M217 / PRC-M504 — health_phi_access_log is append-only.
--
-- health_phi_access_log (db/sql/017) records every access to a student's PHI.
-- It was classified `dml` in db/runtime-table-privileges.json, so the runtime
-- role (proctira_app) held UPDATE/DELETE and could rewrite or erase its own PHI
-- access trail — defeating the point of an access log for the most sensitive
-- data in the system. 053_immutability_privileges hardened fee/audit/transcript
-- tables but not this one.
--
-- This migration makes the table append-only at the database:
--   * a BEFORE UPDATE OR DELETE trigger rejects any mutation of existing rows
--   * UPDATE/DELETE/TRUNCATE/TRIGGER are revoked from proctira_app
-- INSERT and SELECT remain (the log must still be written and read). The
-- privilege class is reclassified to `append_only` in the registry
-- (db/runtime-table-privileges.json) so the CI catalog gate matches.
--
-- Additive / idempotent. Does not edit any applied migration (≤134). No RLS
-- change here (017 governs RLS). The schema-marker bump is the integrator's job.

DO $phi_log_append_only$
BEGIN
  IF to_regclass('public.health_phi_access_log') IS NULL THEN
    RAISE NOTICE 'PRC-M199: health_phi_access_log missing; skipping';
    RETURN;
  END IF;

  CREATE OR REPLACE FUNCTION health_phi_access_log_append_only() RETURNS trigger AS $fn$
  BEGIN
    RAISE EXCEPTION 'health_phi_access_log is append-only (% rejected)', TG_OP
      USING ERRCODE = '42501';
  END;
  $fn$ LANGUAGE plpgsql;

  DROP TRIGGER IF EXISTS trg_health_phi_access_log_append_only ON health_phi_access_log;
  CREATE TRIGGER trg_health_phi_access_log_append_only
    BEFORE UPDATE OR DELETE ON health_phi_access_log
    FOR EACH ROW EXECUTE FUNCTION health_phi_access_log_append_only();

  -- Narrow runtime DML: INSERT/SELECT only (050 grants ALL DML).
  IF EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'proctira_app') THEN
    REVOKE UPDATE, DELETE, TRUNCATE, TRIGGER ON health_phi_access_log FROM proctira_app;
  END IF;
END
$phi_log_append_only$;

-- Assert the guard is in place (fail the apply otherwise).
DO $phi_log_assert$
BEGIN
  IF to_regclass('public.health_phi_access_log') IS NULL THEN
    RETURN;
  END IF;
  IF NOT EXISTS (
    SELECT 1 FROM pg_trigger
     WHERE tgrelid = 'public.health_phi_access_log'::regclass
       AND tgname = 'trg_health_phi_access_log_append_only'
       AND NOT tgisinternal
  ) THEN
    RAISE EXCEPTION 'PRC-M199: append-only trigger missing on health_phi_access_log';
  END IF;
END
$phi_log_assert$;

COMMENT ON TRIGGER trg_health_phi_access_log_append_only ON health_phi_access_log IS
  'PRC-M199/M217/M504 append-only guard: PHI access trail cannot be updated or deleted at runtime.';

INSERT INTO schema_migrations (filename)
VALUES ('190_health_phi_access_log_append_only.sql')
ON CONFLICT (filename) DO NOTHING;
