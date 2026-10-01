#!/usr/bin/env bash
# UP-P0-02 — pre-rollout schema contract using the actual proctira_app URL.
set -euo pipefail

fail() {
  echo "assert-runtime-schema-ready: $*" >&2
  exit 1
}

resolve_database_url() {
  if [[ -n "${DATABASE_URL:-}" ]]; then
    printf '%s' "$DATABASE_URL"
    return 0
  fi
  command -v kubectl >/dev/null 2>&1 || return 1

  local namespace secret key
  namespace="${RUNTIME_ROLE_NAMESPACE:-${RUNTIME_SCHEMA_NAMESPACE:-}}"
  if [[ -z "$namespace" && -n "${ENVIRONMENT:-}" ]]; then
    namespace="proctira-${ENVIRONMENT}"
  fi
  [[ -n "$namespace" ]] || return 1

  secret="${RUNTIME_ROLE_SECRET_NAME:-${RUNTIME_SCHEMA_SECRET_NAME:-}}"
  if [[ -z "$secret" ]]; then
    if [[ "${ENVIRONMENT:-}" == "production" ]]; then
      secret="proctira-prod-secrets"
    else
      secret="proctira-secrets"
    fi
  fi
  key="${RUNTIME_ROLE_SECRET_KEY:-${RUNTIME_SCHEMA_SECRET_KEY:-DATABASE_URL}}"
  echo "assert-runtime-schema-ready: resolving ${namespace}/${secret}:${key}" >&2
  kubectl get secret "$secret" -n "$namespace" -o "jsonpath={.data.${key}}" | base64 -d
}

command -v psql >/dev/null 2>&1 || fail "psql is required"
URL=''
if ! URL="$(resolve_database_url)"; then
  URL=''
fi
[[ -n "${URL// }" ]] || fail "runtime DATABASE_URL is required"

# PRC-L381: derive the contract from packages/shared/database (the list the app
# enforces at boot) instead of a duplicated 6-entry shell list that went stale.
ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/../.." && pwd)"
# shellcheck source=required-migrations-lib.sh
source "$ROOT/tools/scripts/required-migrations-lib.sh"
REQUIRED_MIGRATIONS="$(
  required_runtime_migrations "$ROOT/packages/shared/database/src/schema-readiness.ts"
)" || fail "cannot derive REQUIRED_RUNTIME_MIGRATIONS from schema-readiness.ts"
REQUIRED_MIGRATIONS_CSV="$(paste -sd, - <<<"$REQUIRED_MIGRATIONS")"
EXPECTED_REQUIRED_COUNT="$(wc -l <<<"$REQUIRED_MIGRATIONS" | tr -d ' ')"

ROW="$(psql "$URL" -v ON_ERROR_STOP=1 -At -F $'\t' \
  -v required_migrations="$REQUIRED_MIGRATIONS_CSV" <<'SQL'
  WITH required(filename) AS (
    SELECT unnest(string_to_array(:'required_migrations', ','))
  ), status AS (
    SELECT required.filename,
           migration.migration_applied
      FROM required
      LEFT JOIN LATERAL public.proctira_runtime_migration_status(
        ARRAY[required.filename]::text[]
      ) AS migration ON migration.migration_name = required.filename
  )
  -- Nullable columns must come last: tab is IFS whitespace, so an empty field in
  -- the middle collapses and shifts every later value into the wrong variable.
  SELECT current_user,
         count(*) FILTER (WHERE migration_applied IS DISTINCT FROM true)::text,
         count(*)::text,
         string_agg(filename, ',' ORDER BY filename),
         coalesce(
           string_agg(filename, ',' ORDER BY filename)
             FILTER (WHERE migration_applied IS DISTINCT FROM true),
           ''
         )
    FROM status;
SQL
)"
IFS=$'\t' read -r CURRENT_ROLE MISSING_COUNT REQUIRED_COUNT REQUIRED_NAMES MISSING_NAMES <<<"$ROW"
EXPECTED_ROLE="${RUNTIME_ROLE_EXPECTED:-proctira_app}"
[[ "$CURRENT_ROLE" == "$EXPECTED_ROLE" ]] \
  || fail "current_user is ${CURRENT_ROLE:-unknown}, expected ${EXPECTED_ROLE}"
[[ "${REQUIRED_COUNT:-0}" == "$EXPECTED_REQUIRED_COUNT" ]] \
  || fail "verified ${REQUIRED_COUNT:-0} migrations, expected ${EXPECTED_REQUIRED_COUNT}"
[[ "${MISSING_COUNT:-1}" == "0" ]] \
  || fail "required target migrations missing: ${MISSING_NAMES:-unknown}"

# Report the list the query actually verified. A hardcoded summary here silently
# went stale when 095 and 096 were added to the contract above.
echo "assert-runtime-schema-ready: PASS — ${CURRENT_ROLE} sees all ${REQUIRED_COUNT} required migrations: ${REQUIRED_NAMES}"
