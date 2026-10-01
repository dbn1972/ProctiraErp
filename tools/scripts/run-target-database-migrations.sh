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

# PRC-L188: the required set is every non-seed db/sql file (the production apply
# below runs with APPLY_SEEDS=0 APPLY_STRICT_FKS=1), derived at run time instead
# of a hard-coded spot list that went stale at 096.
# shellcheck source=required-migrations-lib.sh
source "$ROOT/tools/scripts/required-migrations-lib.sh"
REQUIRED_SQL_MIGRATIONS="$(required_sql_migrations "$ROOT/db/sql")" \
  || fail "cannot derive required migrations from db/sql"
REQUIRED_SQL_MIGRATIONS_CSV="$(paste -sd, - <<<"$REQUIRED_SQL_MIGRATIONS")"
REQUIRED_SQL_MIGRATIONS_COUNT="$(wc -l <<<"$REQUIRED_SQL_MIGRATIONS" | tr -d ' ')"

# Prisma wrapper and raw-SQL runner both prefer MIGRATOR_DATABASE_URL.
export DATABASE_URL="$MIGRATOR_DATABASE_URL"
pnpm --filter @proctira/database run prisma:migrate:deploy
APPLY_SEEDS=0 APPLY_STRICT_FKS=1 NODE_ENV=production bash tools/scripts/apply-sql.sh

# Verify the exact target before application rollout. This is intentionally
# owner-side; the separate runtime gate validates proctira_app afterwards.
psql "$MIGRATOR_DATABASE_URL" -v ON_ERROR_STOP=1 -q \
  -v required_migrations="$REQUIRED_SQL_MIGRATIONS_CSV" \
  -v required_count="$REQUIRED_SQL_MIGRATIONS_COUNT" <<'SQL'
-- psql does not interpolate variables inside dollar-quoted DO bodies; hand the
-- derived list over through session settings.
SELECT set_config('proctira.required_migrations', :'required_migrations', false),
       set_config('proctira.required_migration_count', :'required_count', false)
\g /dev/null
DO $verify_target_schema$
DECLARE
  required_names TEXT[] := string_to_array(current_setting('proctira.required_migrations'), ',');
  missing_migrations TEXT;
  invalid_indexes TEXT;
BEGIN
  IF coalesce(cardinality(required_names), 0) = 0
     OR cardinality(required_names) <> current_setting('proctira.required_migration_count')::int THEN
    RAISE EXCEPTION 'target migration contract: derived required list is empty or truncated';
  END IF;

  SELECT string_agg(required.filename, ', ' ORDER BY required.filename)
    INTO missing_migrations
    FROM unnest(required_names) AS required(filename)
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

echo "run-target-database-migrations: PASS — target schema is ready for rollout (${REQUIRED_SQL_MIGRATIONS_COUNT} db/sql migrations verified)"
