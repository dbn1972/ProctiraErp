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

echo "==> Branding smoke: ${WEB_URL}/login must not contain CivitasOne"
html="$(curl -fsS "${WEB_URL}/login")"
echo "$html" | grep -qi 'Proctira' || { echo "FAIL: Proctira brand missing"; exit 1; }
echo "$html" | grep -qi 'CivitasOne' && { echo "FAIL: CivitasOne still present"; exit 1; } || true
echo "$html" | grep -qi 'Keycloak' && { echo "FAIL: Keycloak chrome leaked into /login"; exit 1; } || true
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
# Re-login into cookie jar for /me
curl -fsS -c "$cookie_jar" -X POST "${WEB_URL}/api/auth/login" \
  -H 'content-type: application/json' \
  -d "{\"email\":\"${EMAIL}\",\"password\":\"${PASSWORD}\"}" >/dev/null

echo "==> /api/v1/auth/me (or gateway equivalent)"
# Prefer gateway with bearer if BFF set cookies that are httpOnly (curl jar captures them).
if curl -fsS -b "$cookie_jar" "${API_URL}/api/v1/auth/me" -o /tmp/phase2-me.json; then
  cat /tmp/phase2-me.json
  grep -qi 'proctira\|india\|admin' /tmp/phase2-me.json || {
    echo "WARN: /me payload did not clearly mention india/admin — inspect manually"
  }
  echo "OK /me"
else
  echo "WARN: gateway /me not reachable with cookie jar; check bearer path manually"
fi

echo "==> SQL schema validation"
psql "$DB_URL" -v ON_ERROR_STOP=1 <<'SQL'
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
  AND fn.nspname = 'public'
  AND ft.relname IN ('students', 'institutions');
SQL

echo "Phase 2 EC3 validation finished"
