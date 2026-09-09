#!/usr/bin/env bash
# One-shot batch-3 a11y gate runner (gateway + web + Playwright grep).
set -euo pipefail
ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/../.." && pwd)"
cd "$ROOT"

GW_PORT="${E2E_GATEWAY_PORT:-3040}"
WEB_PORT="${PORT:-3041}"
GATEWAY_URL="http://127.0.0.1:${GW_PORT}"
WEB_URL="http://127.0.0.1:${WEB_PORT}"
DATABASE_URL="${DATABASE_URL:?DATABASE_URL required}"
JWT_SECRET="${JWT_SECRET:-dev-secret-change-in-production}"
B3_GREP="${PLAYWRIGHT_GREP:-reports/dashboard|reports/schedules|reports/dashboards|/lms/bank|/lms/rubrics|/lms/discussions|/lms/lessons|/lms/content|/lms/analytics|/library/opac|/library/holds|/library/fines|/hostel/mess|/hostel/gate-passes|/hostel/fees|/hostel/attendance|/attendance/ops|/staff/attendance|/staff/import|/staff/payroll|/staff/contracts|/communication/circulars|/communication/delivery|/transport/live|/transport/attendance|/transport/alerts|/transport/fees|timetable/generate|timetable/substitutions|circulars/new}"

cleanup() {
  [[ -n "${GW_PID:-}" ]] && kill -- "-$GW_PID" 2>/dev/null || kill "$GW_PID" 2>/dev/null || true
  [[ -n "${WEB_PID:-}" ]] && kill -- "-$WEB_PID" 2>/dev/null || kill "$WEB_PID" 2>/dev/null || true
}
trap cleanup EXIT

if curl -fsS --max-time 2 "${GATEWAY_URL}/health" >/dev/null 2>&1; then
  echo "error: ${GATEWAY_URL} already in use" >&2
  exit 1
fi
if curl -fsS --max-time 2 "${WEB_URL}/login" >/dev/null 2>&1; then
  echo "error: ${WEB_URL} already in use" >&2
  exit 1
fi

psql "$DATABASE_URL" -v ON_ERROR_STOP=1 -q -f "$ROOT/tools/e2e/seed-e2e-tenants.sql"

echo "==> Starting gateway on :${GW_PORT}"
PORT="$GW_PORT" HOST=0.0.0.0 NODE_ENV=development SEED_DEMO_DATA=1 \
  DATABASE_URL="$DATABASE_URL" REDIS_URL="${REDIS_URL:-}" JWT_SECRET="$JWT_SECRET" \
  CORS_ORIGINS="http://localhost:${WEB_PORT},http://127.0.0.1:${WEB_PORT}" \
  RATE_LIMIT_MAX_REQUESTS=10000 \
  setsid pnpm --filter @proctira/api-gateway start > /tmp/a11y-b3-gw.log 2>&1 &
GW_PID=$!

for _ in $(seq 1 60); do
  curl -fsS "${GATEWAY_URL}/health" >/dev/null 2>&1 && break
  sleep 2
done

echo "==> Starting web on :${WEB_PORT}"
cd "$ROOT/apps/web"
NEXT_PUBLIC_GATEWAY_URL="$GATEWAY_URL" \
  setsid pnpm exec next dev --port "$WEB_PORT" > /tmp/a11y-b3-web.log 2>&1 &
WEB_PID=$!
cd "$ROOT"

for _ in $(seq 1 90); do
  curl -fsS --max-time 3 "${WEB_URL}/login" >/dev/null 2>&1 && break
  sleep 3
done

export E2E_BACKEND_READY=1
export E2E_HS256_SESSION=1
export E2E_GATEWAY_URL="$GATEWAY_URL"
export NEXT_PUBLIC_GATEWAY_URL="$GATEWAY_URL"
export PLAYWRIGHT_BASE_URL="$WEB_URL"
export JWT_SECRET

echo "==> Running batch-3 grep: ${B3_GREP}"
pnpm --filter @proctira/web exec playwright test \
  e2e/a11y-axe.spec.ts e2e/dark-mode-parity.spec.ts e2e/touch-target-minimum.spec.ts \
  --project=chromium --workers=1 --grep "$B3_GREP"
