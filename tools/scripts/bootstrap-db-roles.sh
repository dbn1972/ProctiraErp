#!/usr/bin/env bash
# W1-DATA-10 — idempotent Postgres role (+ optional database) bootstrap.
#
# Fresh installs must not require operators to hand-write CREATE ROLE statements.
# The only manual prerequisite is a superuser (or CREATEROLE) connection URL.
#
# Usage:
#   BOOTSTRAP_DATABASE_URL=postgresql://postgres:…@host:5432/postgres \
#   MIGRATOR_PASSWORD=… APP_ROLE_PASSWORD=… \
#   BOOTSTRAP_DB_NAME=proctira \
#   bash tools/scripts/bootstrap-db-roles.sh
#
# Environment:
#   BOOTSTRAP_DATABASE_URL   Superuser / CREATEROLE URL (required unless --dry-run)
#   MIGRATOR_PASSWORD        Password for role proctira (optional; skip ALTER if unset)
#   APP_ROLE_PASSWORD        Password for role proctira_app (optional; skip ALTER if unset)
#   BOOTSTRAP_DB_NAME        If set, CREATE DATABASE … OWNER proctira when missing
#   BOOTSTRAP_EXTENSIONS=1   Create uuid-ossp + pgcrypto on the target DB
#   BOOTSTRAP_PIN_MIGRATOR_ATTRIBUTES=1
#                            ALTER proctira NOSUPERUSER NOBYPASSRLS (CI/prod; not local compose)
#   BOOTSTRAP_SQL            Override path to 01_runtime_roles.sql
#
# Idempotent: safe to re-run. Does not drop roles. Rotates passwords only when
# the corresponding password env vars are set.
set -euo pipefail

ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/../.." && pwd)"
BOOTSTRAP_SQL="${BOOTSTRAP_SQL:-$ROOT/db/bootstrap/01_runtime_roles.sql}"
DRY_RUN=0

usage() {
  cat <<'EOF'
Usage: bootstrap-db-roles.sh [--dry-run] [--help]

Idempotently create ProctiraERP migrator (proctira) and runtime (proctira_app)
roles, optionally create the application database, and set passwords from env.

  --dry-run   Print planned actions; do not connect
  --help      Show this help

Requires BOOTSTRAP_DATABASE_URL (superuser / CREATEROLE). See db/bootstrap/README.md.
EOF
}

for arg in "$@"; do
  case "$arg" in
    --dry-run) DRY_RUN=1 ;;
    --help|-h)
      usage
      exit 0
      ;;
    *)
      echo "Unknown argument: $arg" >&2
      usage >&2
      exit 2
      ;;
  esac
done

if [[ ! -f "$BOOTSTRAP_SQL" ]]; then
  echo "error: bootstrap SQL not found: $BOOTSTRAP_SQL" >&2
  exit 1
fi

if [[ "$DRY_RUN" -eq 1 ]]; then
  echo "==> W1-DATA-10 dry-run: would apply ${BOOTSTRAP_SQL#"$ROOT"/}"
  echo "    BOOTSTRAP_DATABASE_URL=${BOOTSTRAP_DATABASE_URL:-<unset>}"
  echo "    BOOTSTRAP_DB_NAME=${BOOTSTRAP_DB_NAME:-<unset>}"
  echo "    BOOTSTRAP_EXTENSIONS=${BOOTSTRAP_EXTENSIONS:-0}"
  echo "    BOOTSTRAP_PIN_MIGRATOR_ATTRIBUTES=${BOOTSTRAP_PIN_MIGRATOR_ATTRIBUTES:-0}"
  echo "    MIGRATOR_PASSWORD set: $([[ -n "${MIGRATOR_PASSWORD:-}" ]] && echo yes || echo no)"
  echo "    APP_ROLE_PASSWORD set: $([[ -n "${APP_ROLE_PASSWORD:-}" ]] && echo yes || echo no)"
  exit 0
fi

if [[ -z "${BOOTSTRAP_DATABASE_URL:-}" ]]; then
  echo "error: BOOTSTRAP_DATABASE_URL is required (superuser / CREATEROLE connection)" >&2
  echo "  Example: BOOTSTRAP_DATABASE_URL=postgresql://postgres:SECRET@127.0.0.1:5432/postgres" >&2
  exit 1
fi

if ! command -v psql >/dev/null 2>&1; then
  echo "error: psql not found on PATH" >&2
  exit 1
fi

if ! command -v python3 >/dev/null 2>&1; then
  echo "error: python3 required to rewrite BOOTSTRAP_DATABASE_URL database path" >&2
  exit 1
fi

url_with_db() {
  local url="$1"
  local db="$2"
  BOOTSTRAP_DATABASE_URL="$url" BOOTSTRAP_DB_NAME="$db" python3 - <<'PY'
import os, urllib.parse
u = urllib.parse.urlparse(os.environ["BOOTSTRAP_DATABASE_URL"])
print(urllib.parse.urlunparse((u.scheme, u.netloc, "/" + os.environ["BOOTSTRAP_DB_NAME"], "", "", "")))
PY
}

psql_boot() {
  psql "$BOOTSTRAP_DATABASE_URL" -v ON_ERROR_STOP=1 "$@"
}

echo "==> W1-DATA-10: applying ${BOOTSTRAP_SQL#"$ROOT"/} via BOOTSTRAP_DATABASE_URL"
psql_boot -f "$BOOTSTRAP_SQL"

if [[ -n "${MIGRATOR_PASSWORD:-}" ]]; then
  echo "==> Setting password for role proctira"
  psql_boot -q -t -A -v pw="$MIGRATOR_PASSWORD" <<'SQL' >/dev/null
SELECT format('ALTER ROLE proctira PASSWORD %L', :'pw');
\gexec
SQL
fi

if [[ -n "${APP_ROLE_PASSWORD:-}" ]]; then
  echo "==> Setting password for role proctira_app"
  psql_boot -q -t -A -v pw="$APP_ROLE_PASSWORD" <<'SQL' >/dev/null
SELECT format('ALTER ROLE proctira_app PASSWORD %L', :'pw');
\gexec
SQL
fi

if [[ "${BOOTSTRAP_PIN_MIGRATOR_ATTRIBUTES:-0}" == "1" ]]; then
  echo "==> Pinning proctira attributes (NOSUPERUSER NOBYPASSRLS NOCREATEROLE)"
  psql_boot -q <<'SQL'
ALTER ROLE proctira
  NOSUPERUSER
  NOBYPASSRLS
  NOCREATEROLE
  NOREPLICATION;
SQL
fi

TARGET_DB="${BOOTSTRAP_DB_NAME:-}"
if [[ -n "$TARGET_DB" ]]; then
  exists="$(
    psql_boot -At -v db="$TARGET_DB" <<'SQL'
SELECT CASE WHEN EXISTS (
  SELECT 1 FROM pg_database WHERE datname = :'db'
) THEN '1' ELSE '0' END;
SQL
  )"
  if [[ "$exists" == "0" ]]; then
    echo "==> Creating database $TARGET_DB OWNER proctira"
    psql_boot -q -t -A -v db="$TARGET_DB" <<'SQL' >/dev/null
SELECT format('CREATE DATABASE %I OWNER proctira', :'db');
\gexec
SQL
  else
    echo "==> Database $TARGET_DB already exists (skip CREATE)"
  fi

  TARGET_URL="$(url_with_db "$BOOTSTRAP_DATABASE_URL" "$TARGET_DB")"
  echo "==> Granting CONNECT/USAGE on $TARGET_DB"
  psql "$TARGET_URL" -v ON_ERROR_STOP=1 -f "$BOOTSTRAP_SQL"

  if [[ "${BOOTSTRAP_EXTENSIONS:-0}" == "1" ]]; then
    echo "==> Creating extensions on $TARGET_DB"
    psql "$TARGET_URL" -v ON_ERROR_STOP=1 <<'SQL'
CREATE EXTENSION IF NOT EXISTS "uuid-ossp";
CREATE EXTENSION IF NOT EXISTS "pgcrypto";
SQL
  fi
fi

echo "==> Verifying role posture"
verify="$(
  psql_boot -At <<'SQL'
SELECT CASE
  WHEN NOT EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'proctira')
    THEN 'ERROR: proctira missing'
  WHEN NOT EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'proctira_app')
    THEN 'ERROR: proctira_app missing'
  WHEN EXISTS (
    SELECT 1 FROM pg_roles
    WHERE rolname = 'proctira_app'
      AND (rolsuper OR rolbypassrls OR rolcreatedb OR rolcreaterole)
  ) THEN 'ERROR: proctira_app has elevated attributes'
  ELSE 'proctira_app OK'
END;
SQL
)"
echo "    $verify"
if [[ "$verify" != "proctira_app OK" ]]; then
  echo "error: W1-DATA-10 bootstrap verification failed" >&2
  exit 1
fi

echo "==> W1-DATA-10 bootstrap complete"
