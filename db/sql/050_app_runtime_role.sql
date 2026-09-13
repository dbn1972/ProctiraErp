-- W1-DATA-01: split migrator/owner from runtime DML role.
--
-- PostgreSQL table owners bypass RLS unless FORCE ROW LEVEL SECURITY is set.
-- Domain SQL historically ENABLE'd RLS without always FORCEing it (e.g. 047
-- academic_rollover_runs). Connecting the application as the table owner
-- therefore fails open on those tables.
--
-- Posture after this file:
--   - proctira (or whatever role runs Prisma + apply-sql) remains table owner
--   - proctira_app is a non-owner LOGIN role with DML only
--   - application DATABASE_URL must use proctira_app
--
-- Role creation: prefer bootstrap (CI / docker-init / DBA). If the migrator is
-- allowed to CREATE ROLE (local docker POSTGRES_USER), we create it here.
-- Passwords are never set in SQL — bootstrap sets them via ALTER ROLE.

DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'proctira_app') THEN
    BEGIN
      CREATE ROLE proctira_app
        NOSUPERUSER
        NOBYPASSRLS
        NOCREATEDB
        NOCREATEROLE
        NOREPLICATION
        NOINHERIT
        LOGIN;
    EXCEPTION
      WHEN insufficient_privilege THEN
        RAISE EXCEPTION
          'proctira_app role is missing and current_user cannot CREATE ROLE. '
          'Bootstrap must run: CREATE ROLE proctira_app LOGIN NOSUPERUSER NOBYPASSRLS '
          'NOCREATEDB NOCREATEROLE; before applying 050_app_runtime_role.sql';
    END;
  END IF;
END $$;

-- Attribute pinning (NOSUPERUSER / NOBYPASSRLS) requires a superuser and is
-- done in bootstrap (CI / docker-init). Migrator may lack that privilege.

DO $$
BEGIN
  EXECUTE format(
    'GRANT CONNECT ON DATABASE %I TO proctira_app',
    current_database()
  );
END $$;

GRANT USAGE ON SCHEMA public TO proctira_app;

GRANT SELECT, INSERT, UPDATE, DELETE ON ALL TABLES IN SCHEMA public TO proctira_app;
GRANT USAGE, SELECT ON ALL SEQUENCES IN SCHEMA public TO proctira_app;

-- Future objects created by the current migrator/owner.
ALTER DEFAULT PRIVILEGES IN SCHEMA public
  GRANT SELECT, INSERT, UPDATE, DELETE ON TABLES TO proctira_app;
ALTER DEFAULT PRIVILEGES IN SCHEMA public
  GRANT USAGE, SELECT ON SEQUENCES TO proctira_app;
