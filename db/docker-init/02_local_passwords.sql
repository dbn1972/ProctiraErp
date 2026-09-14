-- Local compose password + grants after canonical role bootstrap (W1-DATA-10).
-- docker-compose mounts db/bootstrap/01_runtime_roles.sql as 01_*.sql first.
-- Passwords match .env.example defaults for local development only.

ALTER ROLE proctira_app PASSWORD 'proctira_app_dev_password';

DO $$
BEGIN
  -- Migrator may already be POSTGRES_USER with its compose password; only set
  -- when the role exists (always) — keep local password aligned with .env.example.
  IF EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'proctira') THEN
    ALTER ROLE proctira PASSWORD 'proctira_dev_password';
  END IF;
END $$;

GRANT CONNECT ON DATABASE proctira TO proctira_app;
GRANT USAGE ON SCHEMA public TO proctira_app;
GRANT USAGE ON SCHEMA public TO proctira;
