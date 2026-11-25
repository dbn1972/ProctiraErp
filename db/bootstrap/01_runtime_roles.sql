-- W1-DATA-10: idempotent runtime / migrator role bootstrap for fresh installs.
--
-- Requires a connection that can CREATE ROLE (typically a Postgres superuser).
-- Passwords are intentionally NOT set here — tools/scripts/bootstrap-db-roles.sh
-- applies ALTER ROLE … PASSWORD from environment secrets.
--
-- Posture after this file (when roles are newly created):
--   - proctira      : table-owning migrator (Prisma + apply-sql.sh), NOSUPERUSER NOBYPASSRLS
--   - proctira_app  : non-owner application runtime (DATABASE_URL), NOSUPERUSER NOBYPASSRLS
--   - proctira_phi_retention : PHI retention CronJob (PHI_RETENTION_DATABASE_URL),
--                     NOSUPERUSER NOBYPASSRLS; never the BYPASSRLS backup role (PRC-M623)
--
-- CREATE ROLE is skipped when the role already exists. Local docker-compose runs
-- as a separate bootstrap superuser (POSTGRES_BOOTSTRAP_USER, default postgres)
-- and db/docker-init/02_local_passwords.sh pins proctira NOSUPERUSER NOBYPASSRLS
-- (PRC-L460). Elsewhere, attribute pinning for the migrator is opt-in via
-- bootstrap-db-roles.sh (BOOTSTRAP_PIN_MIGRATOR_ATTRIBUTES=1).

DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'proctira') THEN
    CREATE ROLE proctira
      LOGIN
      NOSUPERUSER
      NOBYPASSRLS
      CREATEDB
      NOCREATEROLE
      NOREPLICATION
      INHERIT;
    RAISE NOTICE 'W1-DATA-10: created role proctira (migrator)';
  ELSE
    RAISE NOTICE 'W1-DATA-10: role proctira already exists (skip CREATE)';
  END IF;
END $$;

DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'proctira_app') THEN
    CREATE ROLE proctira_app
      LOGIN
      NOSUPERUSER
      NOBYPASSRLS
      NOCREATEDB
      NOCREATEROLE
      NOREPLICATION
      NOINHERIT;
    RAISE NOTICE 'W1-DATA-10: created role proctira_app (runtime)';
  ELSE
    RAISE NOTICE 'W1-DATA-10: role proctira_app already exists (skip CREATE)';
  END IF;
END $$;

-- PRC-M623: PHI retention CronJob role, separate from the BYPASSRLS backup
-- role. RLS-bound (binds app.tenant_id per tenant); table grants come from
-- db/sql/312_phi_retention_role_grants.sql.
DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'proctira_phi_retention') THEN
    CREATE ROLE proctira_phi_retention
      LOGIN
      NOSUPERUSER
      NOBYPASSRLS
      NOCREATEDB
      NOCREATEROLE
      NOREPLICATION
      NOINHERIT;
    RAISE NOTICE 'PRC-M623: created role proctira_phi_retention (PHI retention job)';
  ELSE
    RAISE NOTICE 'PRC-M623: role proctira_phi_retention already exists (skip CREATE)';
  END IF;
END $$;
-- Pin runtime attributes whenever the bootstrap connection can (safe on re-run).
DO $$
BEGIN
  BEGIN
    ALTER ROLE proctira_app
      NOSUPERUSER
      NOBYPASSRLS
      NOCREATEDB
      NOCREATEROLE
      NOREPLICATION
      NOINHERIT;
  EXCEPTION
    WHEN insufficient_privilege THEN
      RAISE NOTICE
        'W1-DATA-10: skip pin proctira_app attributes (insufficient_privilege)';
  END;
  BEGIN
    ALTER ROLE proctira_phi_retention
      NOSUPERUSER
      NOBYPASSRLS
      NOCREATEDB
      NOCREATEROLE
      NOREPLICATION
      NOINHERIT;
  EXCEPTION
    WHEN insufficient_privilege THEN
      RAISE NOTICE
        'PRC-M623: skip pin proctira_phi_retention attributes (insufficient_privilege)';
  END;
END $$;

DO $$
BEGIN
  EXECUTE format(
    'GRANT CONNECT ON DATABASE %I TO proctira',
    current_database()
  );
  EXECUTE format(
    'GRANT CONNECT ON DATABASE %I TO proctira_app',
    current_database()
  );
  EXECUTE format(
    'GRANT CONNECT ON DATABASE %I TO proctira_phi_retention',
    current_database()
  );
END $$;

GRANT USAGE ON SCHEMA public TO proctira;
GRANT USAGE ON SCHEMA public TO proctira_app;
GRANT USAGE ON SCHEMA public TO proctira_phi_retention;
