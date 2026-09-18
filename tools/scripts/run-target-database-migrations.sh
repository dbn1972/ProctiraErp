#!/usr/bin/env bash
# UP-P0-02 — fail-closed target migration stage for deploy.yml.
# Uses only the separately scoped migrator credential; application pods never
# receive MIGRATOR_DATABASE_URL.
set -euo pipefail

ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/../.." && pwd)"
cd "$ROOT"

fail() {
  echo "run-target-database-migrations: $*" >&2
  exit 1
}

[[ -n "${MIGRATOR_DATABASE_URL:-}" ]] || fail "MIGRATOR_DATABASE_URL is required"
command -v psql >/dev/null 2>&1 || fail "psql is required"
command -v pnpm >/dev/null 2>&1 || fail "pnpm is required"

EXPECTED_ROLE="${MIGRATOR_ROLE_EXPECTED:-proctira}"
ROLE_ROW="$(psql "$MIGRATOR_DATABASE_URL" -v ON_ERROR_STOP=1 -At -F $'\t' -c "
  SELECT current_user, rolsuper::text, rolbypassrls::text
    FROM pg_roles
   WHERE rolname = current_user
")"
IFS=$'\t' read -r CURRENT_ROLE IS_SUPERUSER BYPASSES_RLS <<<"$ROLE_ROW"
[[ "$CURRENT_ROLE" == "$EXPECTED_ROLE" ]] \
  || fail "migrator current_user is ${CURRENT_ROLE:-unknown}, expected ${EXPECTED_ROLE}"
[[ "$IS_SUPERUSER" != "true" && "$IS_SUPERUSER" != "t" ]] \
  || fail "migrator role must be NOSUPERUSER"
[[ "$BYPASSES_RLS" != "true" && "$BYPASSES_RLS" != "t" ]] \
  || fail "migrator role must be NOBYPASSRLS"

# Prisma wrapper and raw-SQL runner both prefer MIGRATOR_DATABASE_URL.
export DATABASE_URL="$MIGRATOR_DATABASE_URL"
pnpm --filter @proctira/database run prisma:migrate:deploy
APPLY_SEEDS=0 APPLY_STRICT_FKS=1 NODE_ENV=production bash tools/scripts/apply-sql.sh

# Verify the exact target before application rollout. This is intentionally
# owner-side; the separate runtime gate validates proctira_app afterwards.
psql "$MIGRATOR_DATABASE_URL" -v ON_ERROR_STOP=1 <<'SQL'
DO $verify_target_schema$
DECLARE
  missing_migrations TEXT;
  invalid_indexes TEXT;
BEGIN
  SELECT string_agg(required.filename, ', ' ORDER BY required.filename)
    INTO missing_migrations
    FROM (VALUES
      ('082_repair_strict_tenant_fk_validate.sql'),
      ('091_runtime_schema_readiness_contract.sql'),
      ('092_hostel_assignment_uniqueness.sql'),
      ('093_developer_portal_tenant_fks.sql'),
      ('094_developer_portal_api_key_lookup.sql'),
      ('095_w1_data_02_rls_safe_deny.sql'),
      ('096_w1_data_14_audit_fk_integrity.sql')
    ) AS required(filename)
   WHERE NOT EXISTS (
     SELECT 1
       FROM public.schema_migrations AS applied
      WHERE applied.filename = required.filename
        AND applied.checksum IS NOT NULL
   );

  IF missing_migrations IS NOT NULL THEN
    RAISE EXCEPTION 'target migration contract incomplete: %', missing_migrations;
  END IF;

  IF to_regprocedure('public.proctira_hostel_assignment_index_ready(text,text)') IS NULL THEN
    RAISE EXCEPTION 'hostel index contract function is missing';
  END IF;

  SELECT string_agg(required.index_name, ', ' ORDER BY required.index_name)
    INTO invalid_indexes
    FROM (VALUES
      ('uq_hostel_assignments_active_bed', 'bed_id'),
      ('uq_hostel_assignments_active_student', 'student_id')
    ) AS required(index_name, key_column)
   WHERE NOT public.proctira_hostel_assignment_index_ready(
     required.index_name,
     required.key_column
   );

  IF invalid_indexes IS NOT NULL THEN
    RAISE EXCEPTION 'target hostel index contract invalid: %', invalid_indexes;
  END IF;

  IF to_regprocedure('public.proctira_runtime_migration_status(text[])') IS NULL THEN
    RAISE EXCEPTION 'runtime migration-status function is missing';
  END IF;
END
$verify_target_schema$;
SQL

echo "run-target-database-migrations: PASS — target schema is ready for rollout"
