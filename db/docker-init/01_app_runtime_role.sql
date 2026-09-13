-- Docker / local bootstrap: runtime role used by DATABASE_URL (W1-DATA-01).
-- Mounted into docker-entrypoint-initdb.d for fresh volumes only.
-- Password matches .env.example default for local compose.

DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'proctira_app') THEN
    CREATE ROLE proctira_app
      LOGIN
      PASSWORD 'proctira_app_dev_password'
      NOSUPERUSER
      NOBYPASSRLS
      NOCREATEDB
      NOCREATEROLE
      NOREPLICATION
      NOINHERIT;
  END IF;
END $$;

GRANT CONNECT ON DATABASE proctira TO proctira_app;
GRANT USAGE ON SCHEMA public TO proctira_app;
