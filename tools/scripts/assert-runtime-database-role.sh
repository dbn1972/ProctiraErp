#!/usr/bin/env bash
# =============================================================================
# W1-DATA-01 — Runtime DATABASE_URL role gate (deploy / CI)
# =============================================================================
# Connects with the *actual* runtime DATABASE_URL (or resolves it from the
# Kubernetes Secret that pods mount) and asserts the login role:
#   - is not superuser
#   - lacks BYPASSRLS
#   - owns zero application tables in schema public
#   - is not a member of any table-owning role
#   - matches RUNTIME_ROLE_EXPECTED (default: proctira_app)
#
# Fail-closed when RUNTIME_ROLE_GATE_REQUIRED=1 or ENVIRONMENT=production.
#
# Usage (repo root):
#   DATABASE_URL=postgresql://proctira_app:…@host/db \
#     ./tools/scripts/assert-runtime-database-role.sh
#
#   # Deploy context — read the Secret pods use:
#   ENVIRONMENT=production RUNTIME_ROLE_GATE_REQUIRED=1 \
#     RUNTIME_ROLE_NAMESPACE=proctira-production \
#     ./tools/scripts/assert-runtime-database-role.sh
#
# Env:
#   DATABASE_URL                 Preferred when already set (e.g. GH environment secret)
#   RUNTIME_ROLE_NAMESPACE       kubectl namespace (default: proctira-$ENVIRONMENT)
#   RUNTIME_ROLE_SECRET_NAME     Secret name (default: proctira-secrets;
#                                production default: proctira-prod-secrets)
#   RUNTIME_ROLE_SECRET_KEY      Key inside Secret (default: DATABASE_URL)
#   RUNTIME_ROLE_GATE_REQUIRED   1 → fail if URL cannot be resolved
#   RUNTIME_ROLE_EXPECTED        Default proctira_app
# =============================================================================
set -euo pipefail

ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/../.." && pwd)"
cd "$ROOT"

die() {
  echo "assert-runtime-database-role: $*" >&2
  exit 1
}

gate_required() {
  case "${RUNTIME_ROLE_GATE_REQUIRED:-}" in
    1|true|TRUE|yes|YES|on|ON) return 0 ;;
  esac
  case "${ENVIRONMENT:-${GITHUB_ENV:-}}" in
    production|PRODUCTION) return 0 ;;
  esac
  return 1
}

resolve_database_url() {
  if [[ -n "${DATABASE_URL:-}" ]]; then
    printf '%s' "$DATABASE_URL"
    return 0
  fi

  if ! command -v kubectl >/dev/null 2>&1; then
    return 1
  fi

  local ns secret key
  ns="${RUNTIME_ROLE_NAMESPACE:-}"
  if [[ -z "$ns" && -n "${ENVIRONMENT:-}" ]]; then
    ns="proctira-${ENVIRONMENT}"
  fi
  [[ -n "$ns" ]] || return 1

  secret="${RUNTIME_ROLE_SECRET_NAME:-}"
  if [[ -z "$secret" ]]; then
    if [[ "${ENVIRONMENT:-}" == "production" ]]; then
      secret="proctira-prod-secrets"
    else
      secret="proctira-secrets"
    fi
  fi
  key="${RUNTIME_ROLE_SECRET_KEY:-DATABASE_URL}"

  echo "assert-runtime-database-role: resolving ${ns}/${secret}:${key}" >&2
  kubectl get secret "$secret" -n "$ns" -o "jsonpath={.data.${key}}" \
    | base64 -d
}

echo "==> W1-DATA-01 runtime role gate"

URL="$(resolve_database_url || true)"
if [[ -z "${URL// }" ]]; then
  if gate_required; then
    die "DATABASE_URL unset and cluster Secret unresolved — fail closed (RUNTIME_ROLE_GATE_REQUIRED / production)"
  fi
  echo "assert-runtime-database-role: SKIP — DATABASE_URL unset (gate not required)"
  exit 0
fi

export DATABASE_URL="$URL"
# Once a URL is resolved in this wrapper, always fail closed on probe errors.
export RUNTIME_ROLE_GATE_REQUIRED="${RUNTIME_ROLE_GATE_REQUIRED:-1}"

# Prefer Node probe (same evaluator as unit tests). Fall back to psql only when
# the `pg` driver cannot be loaded on a minimal runner.
if command -v node >/dev/null 2>&1; then
  set +e
  NODE_OUT="$(node "$ROOT/tools/scripts/assert-runtime-database-role.mjs" 2>&1)"
  NODE_STATUS=$?
  set -e
  if [[ "$NODE_STATUS" -eq 0 ]]; then
    printf '%s\n' "$NODE_OUT"
    exit 0
  fi
  if printf '%s\n' "$NODE_OUT" | grep -qE "Cannot find module ['\"]pg['\"]|Cannot find package ['\"]pg['\"]"; then
    echo "assert-runtime-database-role: pg unavailable — falling back to psql" >&2
  else
    printf '%s\n' "$NODE_OUT" >&2
    exit "$NODE_STATUS"
  fi
fi

command -v psql >/dev/null 2>&1 || die "neither node+pg nor psql available to probe DATABASE_URL"

EXPECTED="${RUNTIME_ROLE_EXPECTED-proctira_app}"

ROW="$(psql "$DATABASE_URL" -v ON_ERROR_STOP=1 -At -F $'\t' -c "
SELECT
  current_user,
  (SELECT r.rolsuper::text FROM pg_roles r WHERE r.rolname = current_user),
  (SELECT r.rolbypassrls::text FROM pg_roles r WHERE r.rolname = current_user),
  (
    SELECT count(*)::text
    FROM pg_class c
    JOIN pg_namespace n ON n.oid = c.relnamespace
    WHERE n.nspname = 'public'
      AND c.relkind IN ('r', 'p')
      AND c.relowner = (SELECT oid FROM pg_roles WHERE rolname = current_user)
  ),
  EXISTS (
    SELECT 1
    FROM pg_auth_members m
    JOIN pg_roles member ON member.oid = m.member
    WHERE member.rolname = current_user
      AND m.roleid IN (
        SELECT DISTINCT c.relowner
        FROM pg_class c
        JOIN pg_namespace n ON n.oid = c.relnamespace
        WHERE n.nspname = 'public' AND c.relkind IN ('r', 'p')
      )
  )::text
")"

IFS=$'\t' read -r CURRENT_USER ROLSUPER ROLBYPASS OWNED_COUNT OWNER_MEMBER <<<"$ROW"

issues=()
[[ "$ROLSUPER" == "true" || "$ROLSUPER" == "t" ]] && issues+=("role ${CURRENT_USER} is superuser")
[[ "$ROLBYPASS" == "true" || "$ROLBYPASS" == "t" ]] && issues+=("role ${CURRENT_USER} has BYPASSRLS")
[[ "${OWNED_COUNT:-0}" != "0" ]] && issues+=("role ${CURRENT_USER} owns ${OWNED_COUNT} public table(s)")
[[ "$OWNER_MEMBER" == "true" || "$OWNER_MEMBER" == "t" ]] && issues+=("role ${CURRENT_USER} is member of a table-owning role")
if [[ -n "$EXPECTED" && "$CURRENT_USER" != "$EXPECTED" ]]; then
  issues+=("current_user is ${CURRENT_USER}, expected ${EXPECTED}")
fi

if ((${#issues[@]} > 0)); then
  echo "assert-runtime-database-role: FAIL" >&2
  for i in "${issues[@]}"; do
    echo "  - $i" >&2
  done
  exit 1
fi

echo "assert-runtime-database-role: PASS — ${CURRENT_USER} is NOSUPERUSER NOBYPASSRLS, owns 0 public tables, not owner-role member"
