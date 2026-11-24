#!/usr/bin/env bash
# UAT database role bootstrap (same steps as e2e-backend-ready.yml, production posture):
#   1. tools/scripts/bootstrap-db-roles.sh  (proctira migrator + proctira_app runtime,
#      NOSUPERUSER NOBYPASSRLS, extensions, migrator attributes pinned)
#   2. CI role-attribute checks for proctira and proctira_app
#   3. proctira_backup (LOGIN NOSUPERUSER BYPASSRLS + pg_read_all_data; pg-backup.sh)
#   4. keycloak role + database (owner of that database only, NOSUPERUSER)
# Passwords reach psql through \getenv / stdin, never argv.
set -euo pipefail
# shellcheck source=uatenv-lib.sh
source "$(dirname "${BASH_SOURCE[0]}")/uatenv-lib.sh"

REL="${UATENV_RELEASE:-$(uatenv_release_dir)}"
load_env_file "$UATENV_SEC/uatenv.env"
load_env_file "$UATENV_SEC/ops.env"

uatenv_log "bootstrap-db-roles.sh (BOOTSTRAP_PIN_MIGRATOR_ATTRIBUTES=1, NODE_ENV=production)"
BOOTSTRAP_DATABASE_URL="$BOOTSTRAP_DATABASE_URL" \
  MIGRATOR_PASSWORD="$MIGRATOR_PASSWORD" \
  APP_ROLE_PASSWORD="$APP_ROLE_PASSWORD" \
  BOOTSTRAP_DB_NAME=proctira \
  BOOTSTRAP_EXTENSIONS=1 \
  BOOTSTRAP_PIN_MIGRATOR_ATTRIBUTES=1 \
  NODE_ENV=production \
  bash "$REL/tools/scripts/bootstrap-db-roles.sh"

check_role() {
  local url="$1" label="$2" out
  out="$(uatenv_psql "$url" -Atc "SELECT CASE WHEN rolsuper OR rolbypassrls THEN 'ERROR: $label bypasses RLS' ELSE '$label OK: NOSUPERUSER NOBYPASSRLS' END FROM pg_roles WHERE rolname = current_user")"
  echo "    $out"
  [[ "$out" == "$label OK"* ]] || uatenv_die "$label role posture check failed"
}
check_role "$MIGRATOR_DATABASE_URL" "migrator role (proctira)"
check_role "$RUNTIME_DATABASE_URL" "app role (proctira_app)"

uatenv_log "proctira_backup and keycloak roles"
BACKUP_DB_PASSWORD="$BACKUP_DB_PASSWORD" KEYCLOAK_DB_PASSWORD="$KEYCLOAK_DB_PASSWORD" \
  uatenv_psql "$BOOTSTRAP_DATABASE_URL" -q <<'SQL'
\getenv backup_pw BACKUP_DB_PASSWORD
\getenv kc_pw KEYCLOAK_DB_PASSWORD
SELECT 'CREATE ROLE proctira_backup LOGIN NOSUPERUSER BYPASSRLS NOCREATEDB NOCREATEROLE NOREPLICATION'
 WHERE NOT EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'proctira_backup') \gexec
ALTER ROLE proctira_backup LOGIN NOSUPERUSER BYPASSRLS NOCREATEDB NOCREATEROLE NOREPLICATION PASSWORD :'backup_pw';
GRANT pg_read_all_data TO proctira_backup;
GRANT CONNECT ON DATABASE proctira TO proctira_backup;
SELECT 'CREATE ROLE keycloak LOGIN NOSUPERUSER NOBYPASSRLS NOCREATEDB NOCREATEROLE NOREPLICATION'
 WHERE NOT EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'keycloak') \gexec
ALTER ROLE keycloak LOGIN NOSUPERUSER NOBYPASSRLS NOCREATEDB NOCREATEROLE NOREPLICATION PASSWORD :'kc_pw';
SELECT 'CREATE DATABASE keycloak OWNER keycloak'
 WHERE NOT EXISTS (SELECT 1 FROM pg_database WHERE datname = 'keycloak') \gexec
REVOKE CONNECT ON DATABASE keycloak FROM PUBLIC;
REVOKE CONNECT ON DATABASE proctira FROM PUBLIC;
SQL

uatenv_log "role posture"
uatenv_psql "$BOOTSTRAP_DATABASE_URL" -Atc "SELECT rolname || ' rolsuper=' || rolsuper || ' rolbypassrls=' || rolbypassrls || ' rolcreaterole=' || rolcreaterole FROM pg_roles WHERE rolname IN ('proctira','proctira_app','proctira_backup','keycloak') ORDER BY rolname"
