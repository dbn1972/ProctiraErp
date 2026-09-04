#!/usr/bin/env bash
# Phase 4+5 EC3 validation (student + attendance schemas, no cross-schema FKs/joins).
set -euo pipefail

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

echo "==> SQL: student + attendance schemas; no forbidden cross-schema FKs"
run_sql <<'SQL'
SELECT nspname FROM pg_namespace
 WHERE nspname IN ('platform','auth','institution','student','attendance','public')
 ORDER BY 1;

SELECT count(*) AS students FROM student.students;
SELECT count(*) AS enrollments FROM student.enrollments;
SELECT count(*) AS student_attendance FROM attendance.student_attendance;

SELECT count(*) AS forbidden_student_fks
FROM pg_constraint c
JOIN pg_class t ON t.oid = c.conrelid JOIN pg_namespace n ON n.oid = t.relnamespace
JOIN pg_class ft ON ft.oid = c.confrelid JOIN pg_namespace fn ON fn.oid = ft.relnamespace
WHERE c.contype = 'f'
  AND n.nspname = 'student'
  AND fn.nspname IN ('public', 'platform', 'institution', 'attendance', 'auth');

SELECT count(*) AS forbidden_attendance_fks
FROM pg_constraint c
JOIN pg_class t ON t.oid = c.conrelid JOIN pg_namespace n ON n.oid = t.relnamespace
JOIN pg_class ft ON ft.oid = c.confrelid JOIN pg_namespace fn ON fn.oid = ft.relnamespace
WHERE c.contype = 'f'
  AND n.nspname = 'attendance'
  AND fn.nspname IN ('public', 'platform', 'institution', 'student', 'auth');
SQL

echo "==> Auth + students + institutions smoke"
tok_json="$(curl -fsS -X POST "${API_URL}/api/v1/auth/password" \
  -H 'content-type: application/json' \
  -d "{\"email\":\"${EMAIL}\",\"password\":\"${PASSWORD}\"}")"
access="$(printf '%s' "$tok_json" | python3 -c 'import sys,json; d=json.load(sys.stdin); print(d.get("accessToken") or d.get("access_token") or "")')"
test -n "$access" || { echo "FAIL: no accessToken"; echo "$tok_json"; exit 1; }
echo "OK password grant"

for path in /api/v1/students /api/v1/institutions /api/v1/attendance/roster; do
  code="$(curl -sS -o /tmp/p45.json -w '%{http_code}' \
    "${API_URL}${path}" -H "Authorization: Bearer ${access}" || true)"
  echo "${path} -> HTTP ${code}"
done

echo "Phase 4+5 EC3 validation finished"
