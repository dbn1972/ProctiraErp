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
# Same RLS posture as the seed: without app.platform_admin / app.tenant_id the
# app role sees zero rows and the certification would be vacuous.
psql "$DB_URL" -q -v ON_ERROR_STOP=1 <<'SQL' | tee "$ARTIFACT_DIR/verify-counts.txt"
DO $$ BEGIN
  PERFORM set_config('app.platform_admin', '1', false);
  PERFORM set_config('app.tenant_id', '00000000-0000-4000-8000-00000000ce27', false);
END $$;
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
counts = {m.group(1): int(m.group(2)) for m in re.finditer(r"^\s*(\w+)\s*\|\s*(\d+)\s*$", text, re.M)}
expected = {"tenants": 1, "boards": 3, "institutions": 6, "students": 3000, "enrollments": 3000}
ok = all(counts.get(k) == v for k, v in expected.items())
summary = {
  "ok": ok,
  "counts": counts,
  "gap": "G-408",
  "mode": "live-postgres-raw-sql",
  "database": "redacted",
  "profile": {"boards": 3, "schools": 6, "studentsPerSchool": 500, "expectedStudents": 3000},
  "artifactDir": str(artifact),
  "verifySnippet": text.strip().splitlines()[:40],
}
print(json.dumps(summary, indent=2))
if not ok:
    raise SystemExit(f"G-408 certification counts mismatch: {counts} != {expected}")
PY

echo "==> Done. Artifacts in $ARTIFACT_DIR"
