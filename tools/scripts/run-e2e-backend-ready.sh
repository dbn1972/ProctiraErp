#!/usr/bin/env bash
# G-401 — Backend-ready Playwright harness (local + CI).
#
# Spins api-gateway (and relies on Playwright webServer for @proctira/web unless
# PLAYWRIGHT_BASE_URL is already set), exports E2E_BACKEND_READY=1, and runs a
# SMALL write-smoke subset. Does not require live IdP / Keycloak secrets: live
# write specs that use HS256 cookies (JWT_SECRET) can run against the in-process
# gateway. Specs that call loginAsTenantAdmin still need seeded admin users.
#
# Usage:
#   DATABASE_URL=postgresql://... bash tools/scripts/run-e2e-backend-ready.sh
#   bash tools/scripts/run-e2e-backend-ready.sh --skip-stack   # docs/skip summary only
#   E2E_REQUIRE_LIVE=1 bash tools/scripts/run-e2e-backend-ready.sh  # fail if gateway down
#
# Environment (required for a real live pass):
#   DATABASE_URL     Postgres (after prisma migrate deploy + apply-sql.sh)
#   REDIS_URL        Optional; idempotency falls back when unset
#   JWT_SECRET       Must match createSignedJwt (default: gateway dev secret)
#   E2E_GATEWAY_URL  Default http://127.0.0.1:3000
#   PLAYWRIGHT_BASE_URL  Optional; when unset Playwright starts web on :3001
#
# Optional:
#   E2E_SPECS        Space-separated spec paths relative to apps/web
#                    (default: e2e/17b-health-counselling-write-smoke.spec.ts)
#   E2E_REQUIRE_LIVE If 1, exit non-zero when gateway health fails
#   E2E_SKIP_STACK   If 1 (or --skip-stack), print skip summary and exit 0
set -euo pipefail

ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/../.." && pwd)"
cd "$ROOT"

SKIP_STACK=0
for arg in "$@"; do
  case "$arg" in
    --skip-stack) SKIP_STACK=1 ;;
    --help|-h)
      sed -n '2,35p' "$0"
      exit 0
      ;;
    *)
      echo "Unknown argument: $arg" >&2
      exit 2
      ;;
  esac
done

if [[ "${E2E_SKIP_STACK:-0}" == "1" ]]; then
  SKIP_STACK=1
fi

JWT_SECRET="${JWT_SECRET:-dev-secret-change-in-production}"
GATEWAY_URL="${E2E_GATEWAY_URL:-http://127.0.0.1:3000}"
# Extract port from URL (default 3000); avoid python dependency on runners.
GATEWAY_PORT="$(printf '%s' "$GATEWAY_URL" | sed -n 's/.*:\([0-9][0-9]*\)$/\1/p')"
GATEWAY_PORT="${GATEWAY_PORT:-3000}"
export JWT_SECRET
export E2E_BACKEND_READY=1
export E2E_GATEWAY_URL="$GATEWAY_URL"
export NEXT_PUBLIC_GATEWAY_URL="${NEXT_PUBLIC_GATEWAY_URL:-$GATEWAY_URL}"
export GATEWAY_URL="${GATEWAY_URL}"
export CI="${CI:-}"

SPECS="${E2E_SPECS:-e2e/17b-health-counselling-write-smoke.spec.ts}"

print_skip_summary() {
  local reason="$1"
  cat <<EOF

======== G-401 E2E backend-ready — SKIP SUMMARY ========
Reason: ${reason}

What this job / script always expects before a live pass:
  1. Postgres up + DATABASE_URL
  2. pnpm --filter @proctira/database run prisma:migrate:deploy
  3. bash tools/scripts/apply-sql.sh
  4. Redis optional (REDIS_URL) for idempotency
  5. api-gateway on :3000 with JWT_SECRET aligned to Playwright helpers
  6. web on :3001 (or PLAYWRIGHT_BASE_URL)

What still needs seeds / secrets for FULL write journeys:
  - Seeded tenant admins (admin@tenant-a.test) for loginAsTenantAdmin specs
    (10-scholarships, 11-health, a11y authenticated suite, etc.)
  - Live IdP / Keycloak credentials are NOT required for HS256 cookie smokes

Workflow: .github/workflows/e2e-backend-ready.yml
Harness:  tools/scripts/run-e2e-backend-ready.sh
========================================================

EOF
  if [[ -n "${GITHUB_STEP_SUMMARY:-}" ]]; then
    {
      echo "## G-401 E2E backend-ready — skip summary"
      echo ""
      echo "**Reason:** ${reason}"
      echo ""
      echo "See \`tools/scripts/run-e2e-backend-ready.sh\` header for required env."
    } >>"$GITHUB_STEP_SUMMARY"
  fi
}

if [[ "$SKIP_STACK" -eq 1 ]]; then
  print_skip_summary "E2E_SKIP_STACK / --skip-stack set (scaffolding mode; migrate/SQL may still have run in CI)"
  exit 0
fi

if [[ -z "${DATABASE_URL:-}" ]]; then
  if [[ "${E2E_REQUIRE_LIVE:-0}" == "1" ]]; then
    echo "error: DATABASE_URL is required when E2E_REQUIRE_LIVE=1" >&2
    exit 1
  fi
  print_skip_summary "DATABASE_URL unset — cannot start Postgres-backed gateway write path"
  exit 0
fi

GATEWAY_PID=""
cleanup() {
  if [[ -n "$GATEWAY_PID" ]] && kill -0 "$GATEWAY_PID" 2>/dev/null; then
    echo "==> Stopping api-gateway (pid $GATEWAY_PID)"
    kill "$GATEWAY_PID" 2>/dev/null || true
    wait "$GATEWAY_PID" 2>/dev/null || true
  fi
}
trap cleanup EXIT

echo "==> Starting api-gateway (PORT=${GATEWAY_PORT}, JWT_SECRET set)"
(
  cd "$ROOT"
  PORT="$GATEWAY_PORT" \
  HOST=0.0.0.0 \
  NODE_ENV=development \
  DATABASE_URL="$DATABASE_URL" \
  REDIS_URL="${REDIS_URL:-}" \
  JWT_SECRET="$JWT_SECRET" \
  CORS_ORIGINS="http://localhost:3001,http://127.0.0.1:3001" \
  pnpm --filter @proctira/api-gateway start
) >"$ROOT/.e2e-gateway.log" 2>&1 &
GATEWAY_PID=$!

echo "==> Waiting for gateway health at ${GATEWAY_URL}/health"
READY=0
for _ in $(seq 1 60); do
  if curl -fsS "${GATEWAY_URL}/health" >/dev/null 2>&1; then
    READY=1
    break
  fi
  if ! kill -0 "$GATEWAY_PID" 2>/dev/null; then
    echo "error: api-gateway exited early; last log lines:" >&2
    tail -n 80 "$ROOT/.e2e-gateway.log" >&2 || true
    break
  fi
  sleep 2
done

if [[ "$READY" -ne 1 ]]; then
  tail -n 80 "$ROOT/.e2e-gateway.log" >&2 || true
  if [[ "${E2E_REQUIRE_LIVE:-0}" == "1" ]]; then
    echo "error: gateway health check failed and E2E_REQUIRE_LIVE=1" >&2
    exit 1
  fi
  print_skip_summary "api-gateway did not become healthy at ${GATEWAY_URL}/health (see .e2e-gateway.log)"
  exit 0
fi

echo "==> Gateway ready. Running Playwright subset: ${SPECS}"
# Playwright starts @proctira/web via webServer unless PLAYWRIGHT_BASE_URL is set.
# Chromium-only project keeps CI install light.
#
# continue-on-error: false equivalent — propagate Playwright exit code.
set +e
# shellcheck disable=SC2086
pnpm --filter @proctira/web exec playwright test ${SPECS} --project=chromium
PW_EXIT=$?
set -e

if [[ -n "${GITHUB_STEP_SUMMARY:-}" ]]; then
  {
    echo "## G-401 E2E backend-ready"
    echo ""
    echo "- Gateway: \`${GATEWAY_URL}\` (healthy)"
    echo "- Specs: \`${SPECS}\`"
    echo "- Exit: \`${PW_EXIT}\`"
    echo "- E2E_BACKEND_READY=1"
  } >>"$GITHUB_STEP_SUMMARY"
fi

exit "$PW_EXIT"
