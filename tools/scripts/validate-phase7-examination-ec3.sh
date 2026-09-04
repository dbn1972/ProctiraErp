#!/usr/bin/env bash
# Phase 7 EC3 validation — examination schema boundary.
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

echo "==> SQL: examination schema + forbidden cross-schema FKs"
run_sql <<'SQL'
SELECT nspname FROM pg_namespace
 WHERE nspname IN (
   'platform','auth','institution','student','attendance','assessment','examination','public'
 )
 ORDER BY 1;
SELECT count(*) AS examinations FROM examination.examinations;
SELECT count(*) AS candidate_registrations FROM examination.examination_candidate_registrations;
SELECT count(*) AS candidates FROM examination.examination_candidates;
SELECT count(*) AS forbidden_examination_fks
FROM pg_constraint c
JOIN pg_class t ON t.oid = c.conrelid JOIN pg_namespace n ON n.oid = t.relnamespace
JOIN pg_class ft ON ft.oid = c.confrelid JOIN pg_namespace fn ON fn.oid = ft.relnamespace
WHERE c.contype = 'f'
  AND n.nspname = 'examination'
  AND fn.nspname IS DISTINCT FROM 'examination';
SQL

echo "==> Auth + examination API smoke"
tok_json="$(curl -fsS -X POST "${API_URL}/api/v1/auth/password" \
  -H 'content-type: application/json' \
  -d "{\"email\":\"${EMAIL}\",\"password\":\"${PASSWORD}\"}")"
access="$(printf '%s' "$tok_json" | python3 -c 'import sys,json; d=json.load(sys.stdin); print(d.get("accessToken") or "")')"
test -n "$access" || { echo "FAIL: no accessToken"; exit 1; }
for path in /api/v1/examinations /api/v1/students /api/v1/grading-schemes; do
  code="$(curl -sS -o /tmp/p7.json -w '%{http_code}' \
    "${API_URL}${path}" -H "Authorization: Bearer ${access}" || true)"
  echo "${path} -> HTTP ${code}"
done
echo "Phase 7 EC3 validation finished"
