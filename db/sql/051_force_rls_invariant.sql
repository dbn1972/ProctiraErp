-- W1-DATA-02 (A2) — Re-apply FORCE ROW LEVEL SECURITY invariant.
--
-- 021_wave7_integrity_schema.sql forced every RLS-enabled table at apply time.
-- Later migrations (047_academic_rollover_runs_schema.sql, 049_health_phi_breakglass_schema.sql)
-- enabled RLS without FORCE, allowing the table owner role to bypass tenant policies.
--
-- This migration is idempotent: it forces every public table that has rowsecurity
-- but not forcerowsecurity. Safe to re-run; does not drop or alter policies.

-- Explicit regression targets from 047 (documented for auditors / static scans).
ALTER TABLE IF EXISTS academic_rollover_runs FORCE ROW LEVEL SECURITY;
ALTER TABLE IF EXISTS lms_modules FORCE ROW LEVEL SECURITY;
ALTER TABLE IF EXISTS lms_module_items FORCE ROW LEVEL SECURITY;

-- Catch-all for any current or future public RLS table missing FORCE.
DO $$
DECLARE
  t RECORD;
BEGIN
  FOR t IN
    SELECT c.relname AS tablename
    FROM pg_class c
    JOIN pg_namespace n ON n.oid = c.relnamespace
    WHERE n.nspname = 'public'
      AND c.relkind = 'r'
      AND c.relrowsecurity = true
      AND NOT c.relforcerowsecurity
  LOOP
    EXECUTE format('ALTER TABLE %I FORCE ROW LEVEL SECURITY', t.tablename);
  END LOOP;
END $$;

INSERT INTO schema_migrations (filename)
VALUES ('051_force_rls_invariant.sql')
ON CONFLICT (filename) DO NOTHING;
