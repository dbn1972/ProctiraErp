#!/usr/bin/env bash
# UAT-API-004 / PRC-M568 — registration-portal live submit -> track journey.
#
# Seeds the E2E registration fixture (tools/e2e/seed-e2e-registration.sql) as
# the migrator, starts api-gateway the way run-e2e-backend-ready.sh does, builds
# and starts the registration portal in production mode (next build + next
# start, as deployed) against it, then runs
# apps/registration-portal/e2e/03-registration-live-journey.spec.ts with
# E2E_BACKEND_READY=1 and E2E_REQUIRE_LIVE=1.
#
# Fail closed, with no skip mode: a missing env value, seed failure, unhealthy
# gateway or portal, failed test, or any skipped/flaky test exits non-zero.
#
# The gateway resolves anonymous registration tenants from the Host header
# (`<slug>.<TENANT_BASE_DOMAIN>`). The browser opens
# http://<slug>.proctira.localhost:<port>; Chromium resolves *.localhost to
# loopback, so no DNS or /etc/hosts change is needed. Only this harness's
# gateway uses TENANT_BASE_DOMAIN=proctira.localhost (the resolver needs at
# least two labels, so bare "localhost" is rejected).
#
# Usage:
#   DATABASE_URL=... MIGRATOR_DATABASE_URL=... \
#   E2E_REGISTRATION_INSTITUTION_ID=<uuid> bash tools/scripts/run-e2e-registration-live.sh
#
# Environment:
#   DATABASE_URL                     Runtime role URL for the gateway (required)
#   MIGRATOR_DATABASE_URL            Migrator URL for the fixture seed (required)
#   E2E_REGISTRATION_INSTITUTION_ID  Institution uuid to seed and apply to (required)
#   E2E_REGISTRATION_TENANT_ID       Fixture tenant uuid (default ...0000e001)
#   E2E_REGISTRATION_TENANT_SLUG     Fixture tenant slug (default e2e-registration)
#   REDIS_URL                        Optional, passed to the gateway
#   JWT_SECRET                       Gateway secret (default: gateway dev secret)
#   E2E_GATEWAY_URL                  Default http://127.0.0.1:3000
#   E2E_REGISTRATION_PORT            Portal port (default 3002)
#   E2E_REGISTRATION_REPORT          Playwright JSON report path
#                                    (default apps/registration-portal/test-results/registration-live.json)
set -euo pipefail
ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/../.." && pwd)"
cd "$ROOT"

for arg in "$@"; do
  case "$arg" in
    --help|-h)
      sed -n '2,36p' "$0"
      exit 0
      ;;
    *)
      echo "Unknown argument: $arg" >&2
      exit 2
      ;;
  esac
done

UUID_RE='^[0-9a-fA-F]{8}-[0-9a-fA-F]{4}-4[0-9a-fA-F]{3}-[89abAB][0-9a-fA-F]{3}-[0-9a-fA-F]{12}$'
fail() {
  echo "error: $*" >&2
  exit 1
}

[[ -n "${DATABASE_URL:-}" ]] || fail "DATABASE_URL is required (runtime role for api-gateway)"
[[ -n "${MIGRATOR_DATABASE_URL:-}" ]] || fail "MIGRATOR_DATABASE_URL is required (fixture seed)"
INSTITUTION_ID="${E2E_REGISTRATION_INSTITUTION_ID:-}"
[[ -n "$INSTITUTION_ID" ]] || fail "E2E_REGISTRATION_INSTITUTION_ID is required"
[[ "$INSTITUTION_ID" =~ $UUID_RE ]] || fail "E2E_REGISTRATION_INSTITUTION_ID must be a v4 uuid"
TENANT_ID="${E2E_REGISTRATION_TENANT_ID:-00000000-0000-4000-8000-00000000e001}"
[[ "$TENANT_ID" =~ $UUID_RE ]] || fail "E2E_REGISTRATION_TENANT_ID must be a v4 uuid"
SLUG="${E2E_REGISTRATION_TENANT_SLUG:-e2e-registration}"
[[ "$SLUG" =~ ^[a-z0-9]([a-z0-9-]{0,61}[a-z0-9])?$ ]] || fail "E2E_REGISTRATION_TENANT_SLUG must be one DNS label"
command -v psql >/dev/null 2>&1 || fail "psql is required to seed the registration fixture"
command -v curl >/dev/null 2>&1 || fail "curl is required for health checks"

JWT_SECRET="${JWT_SECRET:-dev-secret-change-in-production}"
GATEWAY_URL="${E2E_GATEWAY_URL:-http://127.0.0.1:3000}"
GATEWAY_PORT="$(printf '%s' "$GATEWAY_URL" | sed -n 's/.*:\([0-9][0-9]*\)$/\1/p')"
GATEWAY_PORT="${GATEWAY_PORT:-3000}"
PORTAL_PORT="${E2E_REGISTRATION_PORT:-3002}"
PORTAL_LOCAL_URL="http://127.0.0.1:${PORTAL_PORT}"
BASE_DOMAIN=proctira.localhost
PORTAL_PUBLIC_HOST="${SLUG}.${BASE_DOMAIN}:${PORTAL_PORT}"
PORTAL_PUBLIC_URL="http://${PORTAL_PUBLIC_HOST}"
REPORT="${E2E_REGISTRATION_REPORT:-$ROOT/apps/registration-portal/test-results/registration-live.json}"
GATEWAY_LOG="$ROOT/.e2e-registration-gateway.log"
PORTAL_LOG="$ROOT/.e2e-registration-portal.log"

# A stale gateway or portal would make the health checks pass against code
# that is not the checkout under test.
for url in "$GATEWAY_URL/health" "$PORTAL_LOCAL_URL/api/health"; do
  if curl -fsS --max-time 2 "$url" >/dev/null 2>&1; then
    fail "something is already listening at ${url} — stop it before running the harness"
  fi
done

echo "==> Seeding E2E registration fixture (tools/e2e/seed-e2e-registration.sql)"
psql "$MIGRATOR_DATABASE_URL" -X -q -v ON_ERROR_STOP=1 \
  -v tenant_id="$TENANT_ID" -v slug="$SLUG" -v institution_id="$INSTITUTION_ID" \
  -f "$ROOT/tools/e2e/seed-e2e-registration.sql" >/dev/null

GATEWAY_PID=""
PORTAL_PID=""
stop_group() {
  local pid="$1" name="$2"
  if [[ -n "$pid" ]] && kill -0 "$pid" 2>/dev/null; then
    echo "==> Stopping ${name} (pgid ${pid})"
    kill -- "-$pid" 2>/dev/null || kill "$pid" 2>/dev/null || true
    for _ in $(seq 1 20); do
      kill -0 "$pid" 2>/dev/null || break
      sleep 0.5
    done
    kill -9 -- "-$pid" 2>/dev/null || true
    wait "$pid" 2>/dev/null || true
  fi
}
cleanup() {
  stop_group "$PORTAL_PID" "registration portal"
  stop_group "$GATEWAY_PID" "api-gateway"
}
trap cleanup EXIT

wait_healthy() {
  local url="$1" pid="$2" log="$3" name="$4"
  for _ in $(seq 1 90); do
    if curl -fsS --max-time 5 "$url" >/dev/null 2>&1; then
      return 0
    fi
    if ! kill -0 "$pid" 2>/dev/null; then
      break
    fi
    sleep 2
  done
  tail -n 80 "$log" >&2 || true
  fail "${name} did not become healthy at ${url}"
}

echo "==> Building api-gateway runtime bundle"
pnpm --filter @proctira/api-gateway build

# Same gateway env as run-e2e-backend-ready.sh, except: no demo seed (it writes
# for the demo tenant, which only tools/e2e/seed-e2e-tenants.sql creates; the
# journey does not need it) and TENANT_BASE_DOMAIN for Host routing.
echo "==> Starting api-gateway (PORT=${GATEWAY_PORT}, TENANT_BASE_DOMAIN=${BASE_DOMAIN})"
PORT="$GATEWAY_PORT" \
HOST="${E2E_GATEWAY_HOST:-127.0.0.1}" \
NODE_ENV=development \
SEED_DEMO_DATA=0 \
DATABASE_URL="$DATABASE_URL" \
REDIS_URL="${REDIS_URL:-}" \
JWT_SECRET="$JWT_SECRET" \
TENANT_BASE_DOMAIN="$BASE_DOMAIN" \
CORS_ORIGINS="${PORTAL_PUBLIC_URL},${PORTAL_LOCAL_URL}" \
RATE_LIMIT_MAX_REQUESTS="${RATE_LIMIT_MAX_REQUESTS:-10000}" \
setsid pnpm --filter @proctira/api-gateway start >"$GATEWAY_LOG" 2>&1 &
GATEWAY_PID=$!
wait_healthy "$GATEWAY_URL/health" "$GATEWAY_PID" "$GATEWAY_LOG" "api-gateway"

# Production mode, not next dev: under next dev the success page showed no
# tracking number after a 201 (its read-once sessionStorage effect runs twice
# under React StrictMode in development).
echo "==> Building registration portal"
NEXT_TELEMETRY_DISABLED=1 pnpm --filter @proctira/registration-portal build

echo "==> Starting registration portal (next start, 127.0.0.1:${PORTAL_PORT})"
# The portal needs only GATEWAY_URL and its public base (PRC-L225 redirects);
# database and signing values stay out of it.
env -u DATABASE_URL -u MIGRATOR_DATABASE_URL -u REDIS_URL -u JWT_SECRET \
  GATEWAY_URL="$GATEWAY_URL" PUBLIC_BASE_URL="$PORTAL_PUBLIC_URL" NEXT_TELEMETRY_DISABLED=1 \
  setsid pnpm --filter @proctira/registration-portal exec \
  next start --hostname 127.0.0.1 --port "$PORTAL_PORT" >"$PORTAL_LOG" 2>&1 &
PORTAL_PID=$!
wait_healthy "$PORTAL_LOCAL_URL/api/health" "$PORTAL_PID" "$PORTAL_LOG" "registration portal"

echo "==> Running registration live journey at ${PORTAL_PUBLIC_URL}"
mkdir -p "$(dirname "$REPORT")"
rm -f "$REPORT"
set +e
E2E_BACKEND_READY=1 \
E2E_REQUIRE_LIVE=1 \
E2E_REGISTRATION_INSTITUTION_ID="$INSTITUTION_ID" \
PLAYWRIGHT_BASE_URL="$PORTAL_PUBLIC_URL" \
PLAYWRIGHT_JSON_OUTPUT_FILE="$REPORT" \
  pnpm --filter @proctira/registration-portal exec \
  playwright test e2e/03-registration-live-journey.spec.ts \
  --project=chromium --workers=1 --reporter=list,json
PW_EXIT=$?
# Fail closed on skipped, flaky or missing tests even when Playwright exits 0.
node "$ROOT/tools/scripts/assert-registration-live-report.mjs" --report "$REPORT"
ASSERT_EXIT=$?
set -e

if [[ -n "${GITHUB_STEP_SUMMARY:-}" ]]; then
  {
    echo "## Registration portal live journey (UAT-API-004 / PRC-M568)"
    echo ""
    echo "- Portal: \`${PORTAL_PUBLIC_URL}\`, gateway: \`${GATEWAY_URL}\`"
    echo "- Playwright exit: \`${PW_EXIT}\`, report check exit: \`${ASSERT_EXIT}\`"
  } >>"$GITHUB_STEP_SUMMARY"
fi
if [[ "$PW_EXIT" -ne 0 ]]; then
  fail "registration live journey failed (playwright exit ${PW_EXIT})"
fi
[[ "$ASSERT_EXIT" -eq 0 ]] || fail "registration live report check failed (exit ${ASSERT_EXIT})"
echo "==> Registration live journey passed"
