-- W1-DATA-05 complete — least privilege on schema_migration_phases.
--
-- apply-sql.sh bootstraps schema_migration_phases for resumable non-txn /
-- CONCURRENTLY applies. 050's ALL TABLES grant would otherwise expose it to
-- proctira_app; revoke like schema_migrations / _prisma_migrations (072/075).

DO $$
DECLARE
  t TEXT := 'schema_migration_phases';
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'proctira_app') THEN
    RAISE NOTICE
      'W1-DATA-05: proctira_app missing — skip phase-ledger REVOKE (run bootstrap + 050)';
    RETURN;
  END IF;

  IF to_regclass(format('public.%I', t)) IS NOT NULL THEN
    EXECUTE format('REVOKE ALL ON TABLE %I FROM proctira_app', t);
    EXECUTE format('REVOKE ALL ON TABLE %I FROM PUBLIC', t);
  ELSE
    RAISE NOTICE
      'W1-DATA-05: table %I not present — skip REVOKE (created on first non-txn apply)',
      t;
  END IF;
END $$;

INSERT INTO schema_migrations (filename)
VALUES ('088_schema_migration_phases_privileges.sql')
ON CONFLICT (filename) DO NOTHING;
