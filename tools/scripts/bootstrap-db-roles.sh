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
#   NODE_ENV=production | BOOTSTRAP_REQUIRE_PINNED_MIGRATOR=1
#                            Fail when the migrator role (proctira) is SUPERUSER or
#                            BYPASSRLS after bootstrap (warn loudly otherwise).
#
# PRC-L382: secrets never reach the psql argv. The connection URL is split into
# libpq PG* environment variables and role passwords are written to psql stdin
# by the bash printf builtin (no child process), so `ps` shows neither.
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
  echo "error: python3 required to split BOOTSTRAP_DATABASE_URL into PG* env vars" >&2
  exit 1
fi

# Translate a postgresql:// URL into shell-quoted `export PG...=...` lines so
# credentials travel via the environment instead of the psql command line.
# Unknown query parameters fail closed rather than being silently dropped.
url_to_pg_env() {
  CONN_URL="$1" python3 -c '
import os, shlex, sys, urllib.parse
u = urllib.parse.urlparse(os.environ["CONN_URL"])
if u.scheme not in ("postgres", "postgresql"):
    sys.exit("error: BOOTSTRAP_DATABASE_URL must be a postgresql:// URL")
out = {}
if u.hostname:
    out["PGHOST"] = u.hostname
if u.port:
    out["PGPORT"] = str(u.port)
if u.username:
    out["PGUSER"] = urllib.parse.unquote(u.username)
if u.password is not None:
    out["PGPASSWORD"] = urllib.parse.unquote(u.password)
db = urllib.parse.unquote(u.path.lstrip("/"))
if db:
    out["PGDATABASE"] = db
known = {
    "sslmode": "PGSSLMODE",
    "sslrootcert": "PGSSLROOTCERT",
    "sslcert": "PGSSLCERT",
    "sslkey": "PGSSLKEY",
    "connect_timeout": "PGCONNECT_TIMEOUT",
    "application_name": "PGAPPNAME",
    "options": "PGOPTIONS",
    "target_session_attrs": "PGTARGETSESSIONATTRS",
}
for key, value in urllib.parse.parse_qsl(u.query, keep_blank_values=True):
    if key not in known:
        sys.exit("error: unsupported connection URL parameter: " + key)
    out[known[key]] = value
for key, value in out.items():
    print("export " + key + "=" + shlex.quote(value))
'
}

PG_ENV_EXPORTS="$(url_to_pg_env "$BOOTSTRAP_DATABASE_URL")"
eval "$PG_ENV_EXPORTS"
unset PG_ENV_EXPORTS

psql_boot() {
  psql -v ON_ERROR_STOP=1 "$@"
}

# Write `ALTER ROLE <role> PASSWORD '<pw>'` to psql stdin. printf is a bash
# builtin, so the password never appears in any process argv.
set_role_password() {
  local role="$1"
  local pw="$2"
  local sq="'"
  local quoted="${pw//$sq/$sq$sq}"
  printf "ALTER ROLE %s PASSWORD '%s';\n" "$role" "$quoted" | psql_boot -q >/dev/null
}

echo "==> W1-DATA-10: applying ${BOOTSTRAP_SQL#"$ROOT"/} via BOOTSTRAP_DATABASE_URL"
psql_boot -f "$BOOTSTRAP_SQL"

if [[ -n "${MIGRATOR_PASSWORD:-}" ]]; then
  echo "==> Setting password for role proctira"
  set_role_password proctira "$MIGRATOR_PASSWORD"
fi

if [[ -n "${APP_ROLE_PASSWORD:-}" ]]; then
  echo "==> Setting password for role proctira_app"
  set_role_password proctira_app "$APP_ROLE_PASSWORD"
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

  echo "==> Granting CONNECT/USAGE on $TARGET_DB"
  PGDATABASE="$TARGET_DB" psql -v ON_ERROR_STOP=1 -f "$BOOTSTRAP_SQL"

  if [[ "${BOOTSTRAP_EXTENSIONS:-0}" == "1" ]]; then
    echo "==> Creating extensions on $TARGET_DB"
    PGDATABASE="$TARGET_DB" psql -v ON_ERROR_STOP=1 <<'SQL'
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

echo "==> Verifying migrator posture"
migrator="$(
  psql_boot -At <<'SQL'
SELECT CASE WHEN rolsuper OR rolbypassrls THEN 'ELEVATED' ELSE 'OK' END
FROM pg_roles WHERE rolname = 'proctira';
SQL
)"
if [[ "$migrator" != "OK" ]]; then
  if [[ "${NODE_ENV:-}" == "production" || "${BOOTSTRAP_REQUIRE_PINNED_MIGRATOR:-0}" == "1" ]]; then
    echo "error: migrator role proctira is SUPERUSER or BYPASSRLS; re-run with BOOTSTRAP_PIN_MIGRATOR_ATTRIBUTES=1 (PRC-L382)" >&2
    exit 1
  fi
  echo "WARNING: migrator role proctira is SUPERUSER or BYPASSRLS; acceptable only for local compose. Production requires BOOTSTRAP_PIN_MIGRATOR_ATTRIBUTES=1." >&2
else
  echo "    proctira migrator OK (NOSUPERUSER NOBYPASSRLS)"
fi

echo "==> W1-DATA-10 bootstrap complete"
