#!/usr/bin/env bash
# Phase 14 EC3 validation — report schema boundary.
set -euo pipefail

API_URL="${API_URL:-http://127.0.0.1:3200}"
EMAIL="${INDIA_ADMIN_EMAIL:-admin@proctira.in}"
PASSWORD="${INDIA_ADMIN_PASSWORD:-proctira-india-admin}"
POSTGRES_CONTAINER="${POSTGRES_CONTAINER:-proctira-erp-postgres-1}"

run_sql() {
  if command -v psql >/dev/null 2>&1 && [[ -n "${DATABASE_URL_HOST:-}" ]]; then
    psql "$DATABASE_URL_HOST" -v ON_ERROR_STOP=1 "$@"
  elif docker ps --format '{{.Names}}' | grep -qx "$POSTGRES_CONTAINER"; then
    docker exec -i "$POSTGRES_CONTAINER" psql -U proctira -d proctira -v ON_ERROR_STOP=1 "$@"
  else
    echo "FAIL: no psql/docker postgres"; exit 1
  fi
}

echo "==> SQL: report schema + forbidden cross-schema FKs"
run_sql <<'SQL'
SELECT nspname FROM pg_namespace
 WHERE nspname IN ('platform','auth','institution','student','attendance','assessment','examination','staff','scholarship','transport','health','workflow','notification','report','survey','registration','public')
 ORDER BY 1;
SELECT count(*) AS report_jobs FROM report.report_jobs;
SELECT count(*) AS report_templates FROM report.report_templates;
SELECT count(*) AS scheduled_reports FROM report.scheduled_reports;
SELECT count(*) AS forbidden_report_fks
FROM pg_constraint c
JOIN pg_class t ON t.oid = c.conrelid JOIN pg_namespace n ON n.oid = t.relnamespace
JOIN pg_class ft ON ft.oid = c.confrelid JOIN pg_namespace fn ON fn.oid = ft.relnamespace
WHERE c.contype = 'f'
  AND n.nspname = 'report'
  AND fn.nspname IS DISTINCT FROM 'report';
SQL

echo "==> Auth + regression API smoke"
tok_json="$(curl -fsS -X POST "${API_URL}/api/v1/auth/password" \
  -H 'content-type: application/json' \
  -d "{\"email\":\"${EMAIL}\",\"password\":\"${PASSWORD}\"}")"
access="$(printf '%s' "$tok_json" | python3 -c 'import sys,json; d=json.load(sys.stdin); print(d.get("accessToken") or "")')"
test -n "$access" || { echo "FAIL: no accessToken"; exit 1; }
for path in /api/v1/students /api/v1/staff /api/v1/examinations; do
  code="$(curl -sS -o /tmp/p14.json -w '%{http_code}' \
    "${API_URL}${path}" -H "Authorization: Bearer ${access}" || true)"
  echo "${path} -> HTTP ${code}"
done
echo "Phase 14 EC3 validation finished"
