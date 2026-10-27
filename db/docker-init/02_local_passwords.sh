#!/usr/bin/env bash
# Local compose role passwords + migrator ownership (W1-DATA-10, PRC-L460).
#
# Runs once on a FRESH postgres volume, after db/bootstrap/01_runtime_roles.sql
# created proctira (migrator, NOSUPERUSER NOBYPASSRLS) and proctira_app
# (runtime). The container superuser is the separate bootstrap user
# (POSTGRES_USER = POSTGRES_BOOTSTRAP_USER, default postgres), so the migrator
# is no longer the superuser and RLS binds it as in CI and production.
#
# Passwords come from MIGRATOR_PASSWORD / APP_ROLE_PASSWORD (.env), read by
# psql \getenv so they never appear in argv or in this file. Existing volumes
# are untouched: init scripts only run when the data directory is empty.
set -euo pipefail

case "${POSTGRES_USER:-}" in
  proctira | proctira_app)
    echo "PRC-L460: POSTGRES_USER must be a separate bootstrap superuser, not ${POSTGRES_USER}" >&2
    exit 1
    ;;
esac
: "${MIGRATOR_PASSWORD:?MIGRATOR_PASSWORD is required}"
: "${APP_ROLE_PASSWORD:?APP_ROLE_PASSWORD is required}"

psql -v ON_ERROR_STOP=1 --username "$POSTGRES_USER" --dbname "$POSTGRES_DB" <<'SQL'
\getenv migrator_pw MIGRATOR_PASSWORD
\getenv app_pw APP_ROLE_PASSWORD
\getenv db POSTGRES_DB
ALTER ROLE proctira PASSWORD :'migrator_pw';
ALTER ROLE proctira_app PASSWORD :'app_pw';
-- Same posture as tools/scripts/bootstrap-db-roles.sh in CI: migrator owns the
-- database and schema public, never SUPERUSER / BYPASSRLS.
ALTER ROLE proctira NOSUPERUSER NOBYPASSRLS;
SELECT format('ALTER DATABASE %I OWNER TO proctira', :'db') \gexec
GRANT USAGE, CREATE ON SCHEMA public TO proctira;
GRANT USAGE ON SCHEMA public TO proctira_app;
-- BOOTSTRAP_EXTENSIONS=1 equivalent (created by the superuser).
CREATE EXTENSION IF NOT EXISTS "uuid-ossp";
CREATE EXTENSION IF NOT EXISTS "pgcrypto";
DO $$
BEGIN
  IF EXISTS (
    SELECT 1 FROM pg_roles
     WHERE rolname IN ('proctira', 'proctira_app')
       AND (rolsuper OR rolbypassrls)
  ) THEN
    RAISE EXCEPTION 'PRC-L460: proctira / proctira_app must be NOSUPERUSER NOBYPASSRLS';
  END IF;
END $$;
SQL
