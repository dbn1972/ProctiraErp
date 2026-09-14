-- W1-DATA-10: idempotent runtime / migrator role bootstrap for fresh installs.
--
-- Requires a connection that can CREATE ROLE (typically a Postgres superuser).
-- Passwords are intentionally NOT set here — tools/scripts/bootstrap-db-roles.sh
-- applies ALTER ROLE … PASSWORD from environment secrets.
--
-- Posture after this file (when roles are newly created):
--   - proctira      : table-owning migrator (Prisma + apply-sql.sh), NOSUPERUSER NOBYPASSRLS
--   - proctira_app  : non-owner application runtime (DATABASE_URL), NOSUPERUSER NOBYPASSRLS
--
-- Local docker-compose may already create POSTGRES_USER=proctira as a superuser;
-- CREATE ROLE is skipped when the role exists. Attribute pinning for the migrator
-- is opt-in via bootstrap-db-roles.sh (BOOTSTRAP_PIN_MIGRATOR_ATTRIBUTES=1) so
-- local compose is not demoted.

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
END $$;

GRANT USAGE ON SCHEMA public TO proctira;
GRANT USAGE ON SCHEMA public TO proctira_app;
