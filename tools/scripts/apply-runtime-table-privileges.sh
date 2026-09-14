#!/usr/bin/env bash
# W1-DATA-11 COMPLETE — sync proctira_app table privileges from the classification catalog.
#
# Invoked at the end of tools/scripts/apply-sql.sh so current and future tables
# only receive explicitly classified grants (no blanket DEFAULT PRIVILEGES).
set -euo pipefail

ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/../.." && pwd)"
# shellcheck source=migration-timeouts.sh
source "$ROOT/tools/scripts/migration-timeouts.sh"

if [[ "${1:-}" == "--dry-run" ]]; then
  node "$ROOT/tools/scripts/check-runtime-table-privileges.mjs" --print-sql
  exit 0
fi

if ! command -v psql >/dev/null 2>&1; then
  echo "error: psql not found on PATH" >&2
  exit 1
fi
if ! command -v node >/dev/null 2>&1; then
  echo "error: node not found on PATH" >&2
  exit 1
fi

APPLY_DATABASE_URL="${MIGRATOR_DATABASE_URL:-${DATABASE_URL:-}}"
PSQL_ARGS=(-v ON_ERROR_STOP=1)
if [[ -n "${APPLY_DATABASE_URL}" ]]; then
  PSQL_TARGET=("$APPLY_DATABASE_URL")
else
  export PGDATABASE="${PGDATABASE:-proctira}"
  PSQL_TARGET=()
fi

export_migration_timeout_pgoptions

psql_q() {
  {
    printf "SET lock_timeout TO '%s';\n" "${APPLY_SQL_LOCK_TIMEOUT}"
    printf "SET statement_timeout TO '%s';\n" "${APPLY_SQL_STATEMENT_TIMEOUT}"
    cat
  } | psql "${PSQL_TARGET[@]}" "${PSQL_ARGS[@]}" "$@"
}

echo "==> W1-DATA-11 syncing runtime table privileges from db/runtime-table-privileges.json"
SQL="$(node "$ROOT/tools/scripts/check-runtime-table-privileges.mjs" --print-sql)"
psql_q <<SQL
${SQL}
SQL
echo "==> W1-DATA-11 runtime privilege sync complete"
