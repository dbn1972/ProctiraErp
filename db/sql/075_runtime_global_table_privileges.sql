-- W1-DATA-11 residual — least privilege on platform-global catalogs.
--
-- 072_control_ledger_privileges.sql already REVOKEs ALL on schema_migrations
-- and _prisma_migrations from proctira_app (+ PUBLIC). This file closes the
-- remaining "global tables" half of the finding:
--
--   insights_ui_templates / insights_ui_indicators / insights_ui_geo_features
--   are platform reference data without tenant_id or RLS (see 021). 050 still
--   grants them full DML. Runtime may SELECT (and INSERT for catalog seed /
--   createTemplate) but must not UPDATE, DELETE, TRUNCATE, or own TRIGGER.
--
-- Also re-asserts REVOKE ALL on migration ledgers (idempotent if 072 applied).

DO $$
DECLARE
  t TEXT;
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'proctira_app') THEN
    RAISE NOTICE
      'W1-DATA-11: proctira_app missing — skip privilege narrow (run bootstrap + 050)';
    RETURN;
  END IF;

  -- Migration ledgers: reinforce 072 (safe if already revoked).
  FOREACH t IN ARRAY ARRAY[
    'schema_migrations',
    '_prisma_migrations'
  ]
  LOOP
    IF to_regclass(format('public.%I', t)) IS NOT NULL THEN
      EXECUTE format('REVOKE ALL ON TABLE %I FROM proctira_app', t);
      EXECUTE format('REVOKE ALL ON TABLE %I FROM PUBLIC', t);
    END IF;
  END LOOP;

  -- Platform-global catalogs: strip mutate rights, then re-grant least privilege.
  FOREACH t IN ARRAY ARRAY[
    'insights_ui_templates',
    'insights_ui_indicators',
    'insights_ui_geo_features'
  ]
  LOOP
    IF to_regclass(format('public.%I', t)) IS NOT NULL THEN
      EXECUTE format('REVOKE ALL ON TABLE %I FROM proctira_app', t);
      EXECUTE format('GRANT SELECT, INSERT ON TABLE %I TO proctira_app', t);
    ELSE
      RAISE NOTICE
        'W1-DATA-11: catalog %I not present — skip (apply 020 first)',
        t;
    END IF;
  END LOOP;
END $$;

INSERT INTO schema_migrations (filename)
VALUES ('075_runtime_global_table_privileges.sql')
ON CONFLICT (filename) DO NOTHING;
