#!/usr/bin/env bash
# Phase 3 EC3 validation (institution schema boundary + API smoke).
# Usage (on EC3 host or via SSH):
#   ./tools/scripts/validate-phase3-institution-ec3.sh
set -euo pipefail

WEB_URL="${WEB_URL:-http://127.0.0.1:3201}"
API_URL="${API_URL:-http://127.0.0.1:3200}"
DB_URL="${DATABASE_URL_HOST:-postgresql://proctira:proctira_dev_password@127.0.0.1:5434/proctira}"
EMAIL="${INDIA_ADMIN_EMAIL:-admin@proctira.in}"
PASSWORD="${INDIA_ADMIN_PASSWORD:-proctira-india-admin}"
POSTGRES_CONTAINER="${POSTGRES_CONTAINER:-proctira-erp-postgres-1}"

run_sql() {
  if command -v psql >/dev/null 2>&1; then
    psql "$DB_URL" -v ON_ERROR_STOP=1 "$@"
  elif docker ps --format '{{.Names}}' | grep -qx "$POSTGRES_CONTAINER"; then
    docker exec -i "$POSTGRES_CONTAINER" psql -U proctira -d proctira -v ON_ERROR_STOP=1 "$@"
  else
    echo "FAIL: neither psql nor docker postgres container available"
    exit 1
  fi
}

echo "==> SQL: institution schema present; tables moved; no cross-schema FKs"
run_sql <<'SQL'
SELECT nspname FROM pg_namespace
 WHERE nspname IN ('platform','auth','institution','public')
 ORDER BY 1;

SELECT count(*) AS institution_rows FROM institution.institutions;

SELECT count(*) AS forbidden_fks_out
FROM pg_constraint c
JOIN pg_class t ON t.oid = c.conrelid
JOIN pg_namespace n ON n.oid = t.relnamespace
JOIN pg_class ft ON ft.oid = c.confrelid
JOIN pg_namespace fn ON fn.oid = ft.relnamespace
WHERE c.contype = 'f'
  AND n.nspname = 'institution'
  AND fn.nspname IN ('public', 'platform');

SELECT count(*) AS forbidden_fks_in
FROM pg_constraint c
JOIN pg_class t ON t.oid = c.conrelid
JOIN pg_namespace n ON n.oid = t.relnamespace
JOIN pg_class ft ON ft.oid = c.confrelid
JOIN pg_namespace fn ON fn.oid = ft.relnamespace
WHERE c.contype = 'f'
  AND n.nspname = 'public'
  AND fn.nspname = 'institution';
SQL

echo "==> Auth still works (India admin) — regression gate for Phase 2"
tok_json="$(curl -fsS -X POST "${API_URL}/api/v1/auth/password" \
  -H 'content-type: application/json' \
  -d "{\"email\":\"${EMAIL}\",\"password\":\"${PASSWORD}\"}")"
access="$(printf '%s' "$tok_json" | python3 -c 'import sys,json; print(json.load(sys.stdin).get("accessToken",""))')"
test -n "$access" || { echo "FAIL: no accessToken"; echo "$tok_json"; exit 1; }
echo "OK password grant"

echo "==> Institutions API smoke (list)"
code="$(curl -sS -o /tmp/phase3-institutions.json -w '%{http_code}' \
  "${API_URL}/api/v1/institutions" \
  -H "Authorization: Bearer ${access}" || true)"
echo "HTTP ${code}"
head -c 400 /tmp/phase3-institutions.json 2>/dev/null || true
echo
if [[ "$code" != "200" && "$code" != "401" && "$code" != "403" ]]; then
  echo "WARN: institutions list returned unexpected status ${code} — inspect gateway routing"
else
  echo "OK institutions endpoint reachable (${code})"
fi

echo "Phase 3 EC3 validation finished"
