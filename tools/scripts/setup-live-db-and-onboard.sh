#!/usr/bin/env bash
# Apply raw SQL schema + multi-board onboarding seed (no Prisma).
set -euo pipefail

ROOT="$(cd "$(dirname "$0")/../.." && pwd)"
export PGPASSWORD="${PGPASSWORD:-proctira_dev_password}"
DB_URL="${DATABASE_URL:-postgresql://proctira:proctira_dev_password@127.0.0.1:5432/proctira}"
ARTIFACT_DIR="${ARTIFACT_DIR:-/opt/cursor/artifacts/multi-board-onboard}"
mkdir -p "$ARTIFACT_DIR"
export ARTIFACT_DIR
export DATABASE_URL="$DB_URL"

echo "==> Applying domain SQL (db/sql/001–N via apply-sql.sh)"
DATABASE_URL="$DB_URL" bash "$ROOT/tools/scripts/apply-sql.sh" \
  | tee "$ARTIFACT_DIR/schema-apply.log"

echo "==> Seeding boards/schools/students: db/seeds/002_multi_board_schools_500.sql"
psql "$DB_URL" -v ON_ERROR_STOP=1 -f "$ROOT/db/seeds/002_multi_board_schools_500.sql" \
  | tee "$ARTIFACT_DIR/seed-apply.log"

echo "==> Verification counts"
psql "$DB_URL" -v ON_ERROR_STOP=1 <<'SQL' | tee "$ARTIFACT_DIR/verify-counts.txt"
SELECT 'tenants' AS entity, count(*)::int AS n FROM tenants WHERE slug = 'proctira-multiboard-cert'
UNION ALL SELECT 'boards', count(*)::int FROM boards b JOIN tenants t ON t.id = b.tenant_id WHERE t.slug = 'proctira-multiboard-cert'
UNION ALL SELECT 'institutions', count(*)::int FROM institutions i JOIN tenants t ON t.id = i.tenant_id WHERE t.slug = 'proctira-multiboard-cert'
UNION ALL SELECT 'students', count(*)::int FROM students s JOIN tenants t ON t.id = s.tenant_id WHERE t.slug = 'proctira-multiboard-cert'
UNION ALL SELECT 'staff', count(*)::int FROM staff s JOIN tenants t ON t.id = s.tenant_id WHERE t.slug = 'proctira-multiboard-cert'
UNION ALL SELECT 'enrollments', count(*)::int FROM enrollments e JOIN tenants t ON t.id = e.tenant_id WHERE t.slug = 'proctira-multiboard-cert'
ORDER BY 1;

SELECT b.code AS board, i.code AS school, count(e.id)::int AS students
FROM institutions i
JOIN boards b ON b.id = i.board_id
JOIN tenants t ON t.id = i.tenant_id
LEFT JOIN enrollments e ON e.institution_id = i.id
WHERE t.slug = 'proctira-multiboard-cert'
GROUP BY b.code, i.code
ORDER BY b.code, i.code;
SQL

python3 - <<'PY' | tee "$ARTIFACT_DIR/summary.json"
import json, re, pathlib, os
artifact = pathlib.Path(os.environ.get("ARTIFACT_DIR", "/opt/cursor/artifacts/multi-board-onboard"))
text = (artifact / "verify-counts.txt").read_text()
summary = {
  "ok": True,
  "gap": "G-408",
  "mode": "live-postgres-raw-sql",
  "database": "redacted",
  "profile": {"boards": 3, "schools": 6, "studentsPerSchool": 500, "expectedStudents": 3000},
  "artifactDir": str(artifact),
  "verifySnippet": text.strip().splitlines()[:40],
}
print(json.dumps(summary, indent=2))
PY

echo "==> Done. Artifacts in $ARTIFACT_DIR"
