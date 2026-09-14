-- W1-DATA-11 — least-privilege on global control ledgers.
--
-- 050 grants SELECT, INSERT, UPDATE, DELETE on ALL TABLES IN SCHEMA public to
-- proctira_app. That incorrectly includes migrator-owned global control tables:
--   * schema_migrations  — domain SQL apply ledger (apply-sql.sh / W1-DATA-05)
--   * _prisma_migrations — Prisma migrate history
--
-- Posture after this file:
--   * proctira_app has NO privileges on those ledgers (no SELECT / DML)
--   * PUBLIC has no privileges either (defense in depth)
--   * migrator/owner (proctira via MIGRATOR_DATABASE_URL) retains full access
--
-- Apply order: Prisma migrate deploy creates _prisma_migrations before
-- apply-sql.sh; schema_migrations is created in 021 (or by apply-sql bootstrap).

DO $$
DECLARE
  t TEXT;
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'proctira_app') THEN
    RAISE NOTICE
      'W1-DATA-11: proctira_app missing — skip control-ledger REVOKE (run bootstrap + 050)';
    RETURN;
  END IF;

  FOREACH t IN ARRAY ARRAY[
    'schema_migrations',
    '_prisma_migrations'
  ]
  LOOP
    IF to_regclass(format('public.%I', t)) IS NOT NULL THEN
      EXECUTE format('REVOKE ALL ON TABLE %I FROM proctira_app', t);
      EXECUTE format('REVOKE ALL ON TABLE %I FROM PUBLIC', t);
    ELSE
      RAISE NOTICE
        'W1-DATA-11: table %I not present — skip REVOKE (re-apply after Prisma/021)',
        t;
    END IF;
  END LOOP;
END $$;

INSERT INTO schema_migrations (filename)
VALUES ('072_control_ledger_privileges.sql')
ON CONFLICT (filename) DO NOTHING;
