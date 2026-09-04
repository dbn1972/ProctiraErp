#!/usr/bin/env bash
# Phase 2 EC3 validation checklist (India admin login + auth schema).
# Usage (on EC3 host or via SSH with DATABASE_URL_HOST / WEB_URL set):
#   ./tools/scripts/validate-phase2-auth-ec3.sh
set -euo pipefail

WEB_URL="${WEB_URL:-http://127.0.0.1:3201}"
API_URL="${API_URL:-http://127.0.0.1:3200}"
DB_URL="${DATABASE_URL_HOST:-postgresql://proctira:proctira_dev_password@127.0.0.1:5434/proctira}"
EMAIL="${INDIA_ADMIN_EMAIL:-admin@proctira.in}"
PASSWORD="${INDIA_ADMIN_PASSWORD:-proctira-india-admin}"
POSTGRES_CONTAINER="${POSTGRES_CONTAINER:-proctira-erp-postgres-1}"

echo "==> Branding smoke: ${WEB_URL}/login"
html="$(curl -fsS "${WEB_URL}/login")"
echo "$html" | grep -qi 'Proctira' || { echo "FAIL: Proctira brand missing"; exit 1; }
echo "$html" | grep -qi 'CivitasOne' && { echo "FAIL: CivitasOne still present"; exit 1; } || true
# Soft check: Next RSC may embed i18n *key names* containing "Keycloak"; fail only on visible chrome cues.
if echo "$html" | grep -qiE 'kc-login|id="kc-|Keycloak Account|Powered by Keycloak'; then
  echo "FAIL: Keycloak chrome leaked into /login"
  exit 1
fi
echo "$html" | grep -qi 'Every school, every student\|AuthShell\|Welcome back' && echo "OK AuthShell cues" || echo "WARN: AuthShell hero copy not detected"
echo "OK branding"

echo "==> Password login via web BFF"
login_headers="$(mktemp)"
curl -fsS -D "$login_headers" -o /tmp/phase2-login.json \
  -X POST "${WEB_URL}/api/auth/login" \
  -H 'content-type: application/json' \
  -d "{\"email\":\"${EMAIL}\",\"password\":\"${PASSWORD}\"}"
grep -qi 'set-cookie:.*access' "$login_headers" || {
  echo "FAIL: access cookie missing"; cat /tmp/phase2-login.json; exit 1;
}
echo "OK login cookies"

cookie_jar="$(mktemp)"
curl -fsS -c "$cookie_jar" -X POST "${WEB_URL}/api/auth/login" \
  -H 'content-type: application/json' \
  -d "{\"email\":\"${EMAIL}\",\"password\":\"${PASSWORD}\"}" >/dev/null

echo "==> Gateway password grant + /api/v1/auth/me"
tok_json="$(curl -fsS -X POST "${API_URL}/api/v1/auth/password" \
  -H 'content-type: application/json' \
  -d "{\"email\":\"${EMAIL}\",\"password\":\"${PASSWORD}\"}")"
access="$(printf '%s' "$tok_json" | python3 -c 'import sys,json; print(json.load(sys.stdin).get("accessToken",""))')"
test -n "$access" || { echo "FAIL: no accessToken"; echo "$tok_json"; exit 1; }
curl -fsS "${API_URL}/api/v1/auth/me" -H "Authorization: Bearer ${access}" -o /tmp/phase2-me.json
cat /tmp/phase2-me.json
grep -qi 'proctira\|india\|admin' /tmp/phase2-me.json || {
  echo "WARN: /me payload did not clearly mention india/admin — inspect manually"
}
echo "OK /me"

echo "==> SQL schema validation"
run_sql() {
  if command -v psql >/dev/null 2>&1; then
    psql "$DB_URL" -v ON_ERROR_STOP=1 "$@"
  elif docker ps --format '{{.Names}}' | grep -qx "$POSTGRES_CONTAINER"; then
    docker exec -i "$POSTGRES_CONTAINER" psql -U proctira -d proctira -v ON_ERROR_STOP=1 "$@"
  else
    echo "FAIL: neither psql nor docker postgres container available"; exit 1
  fi
}

run_sql <<'SQL'
SELECT nspname FROM pg_namespace WHERE nspname IN ('platform','auth') ORDER BY 1;
SELECT count(*) AS auth_users FROM auth.users;
SELECT count(*) AS auth_identities FROM auth.user_identities WHERE provider = 'keycloak';
SELECT count(*) AS forbidden_fks
FROM pg_constraint c
JOIN pg_class t ON t.oid = c.conrelid
JOIN pg_namespace n ON n.oid = t.relnamespace
JOIN pg_class ft ON ft.oid = c.confrelid
JOIN pg_namespace fn ON fn.oid = ft.relnamespace
WHERE c.contype = 'f'
  AND n.nspname = 'auth'
  AND fn.nspname IN ('public', 'platform');
SQL

echo "Phase 2 EC3 validation finished"
