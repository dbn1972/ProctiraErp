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

ROW="$(psql "$URL" -v ON_ERROR_STOP=1 -At -F $'\t' -c "
  WITH required(filename) AS (
    VALUES
      ('082_repair_strict_tenant_fk_validate.sql'),
      ('092_hostel_assignment_uniqueness.sql'),
      ('093_developer_portal_tenant_fks.sql'),
      ('094_developer_portal_api_key_lookup.sql'),
      ('095_w1_data_02_rls_safe_deny.sql'),
      ('096_w1_data_14_audit_fk_integrity.sql')
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
    FROM status
")"
IFS=$'\t' read -r CURRENT_ROLE MISSING_COUNT REQUIRED_COUNT REQUIRED_NAMES MISSING_NAMES <<<"$ROW"
EXPECTED_ROLE="${RUNTIME_ROLE_EXPECTED:-proctira_app}"
[[ "$CURRENT_ROLE" == "$EXPECTED_ROLE" ]] \
  || fail "current_user is ${CURRENT_ROLE:-unknown}, expected ${EXPECTED_ROLE}"
[[ "${MISSING_COUNT:-1}" == "0" ]] \
  || fail "required target migrations missing: ${MISSING_NAMES:-unknown}"

# Report the list the query actually verified. A hardcoded summary here silently
# went stale when 095 and 096 were added to the contract above.
echo "assert-runtime-schema-ready: PASS — ${CURRENT_ROLE} sees all ${REQUIRED_COUNT} required migrations: ${REQUIRED_NAMES}"
