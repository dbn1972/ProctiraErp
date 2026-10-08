-- PRC-H040: one student_attendance row per (tenant, student, class, date,
-- subject, period).
--
-- AttendanceService recorded attendance with find-then-create across two
-- separate transactions, so two concurrent writers (teacher double-submit, bulk
-- + device punch) could each miss the other and insert two rows for the same
-- student/day — later updates then hit only one and percentage counts
-- double-count the day (a student can be both PRESENT and ABSENT).
--
-- subject_id / period_id are nullable (daily vs period-level), so a plain
-- unique would let (…, NULL, NULL) duplicate. We COALESCE the nullable columns
-- to the all-zero UUID inside the index expression so NULLs collapse to one
-- logical key. The repository create() now also catches the resulting
-- violation and returns the existing row (race → single row).
--
-- student_attendance is a Prisma FORCE-RLS table. Cross-tenant rows stay
-- independent because tenant_id is the leading column.
--
-- W1-DATA-17: building the unique index with CREATE UNIQUE INDEX (plain) takes
-- an ACCESS EXCLUSIVE lock for the whole build, which can queue behind app
-- traffic. Build it CONCURRENTLY instead so writers are not blocked. Because
-- CONCURRENTLY cannot run inside a transaction, this is a non-transactional file
-- (apply-sql.sh detects the CONCURRENTLY keyword and applies it statement-by-
-- statement via the schema_migration_phases ledger). Every statement below is
-- idempotent compensating-forward DDL, per db/README.md, because a crash between
-- a statement commit and its phase-ledger row re-runs the statement. apply-sql.sh
-- records schema_migrations after the file completes, so there is no
-- INSERT INTO schema_migrations line here (same as db/sql/102).
--
-- Data safety: existing duplicates are NOT deleted (attendance is evidence of
-- minors' presence). The preflight fails the apply with a count so an operator
-- can reconcile first. A new database has none.
-- Rollback: forward-only; a later migration may drop the index to relax.

-- 1) Preflight: refuse to build over duplicates. Lift FORCE RLS for the owner
--    scan and restore it in the same block (atomic DO block).
DO $h040_preflight$
DECLARE
  was_forced boolean;
  duplicate_groups bigint;
BEGIN
  IF to_regclass('public.student_attendance') IS NULL THEN
    RAISE NOTICE 'PRC-H040: student_attendance missing; skipping';
    RETURN;
  END IF;
  SELECT relforcerowsecurity INTO was_forced
    FROM pg_class WHERE oid = 'public.student_attendance'::regclass;
  IF was_forced THEN
    ALTER TABLE student_attendance NO FORCE ROW LEVEL SECURITY;
  END IF;
  SELECT count(*) INTO duplicate_groups
    FROM (
      SELECT 1
        FROM student_attendance
       GROUP BY tenant_id, student_id, class_id, date,
                COALESCE(subject_id, '00000000-0000-0000-0000-000000000000'::uuid),
                COALESCE(period_id, '00000000-0000-0000-0000-000000000000'::uuid)
      HAVING count(*) > 1
    ) d;
  IF was_forced THEN
    ALTER TABLE student_attendance FORCE ROW LEVEL SECURITY;
  END IF;
  IF duplicate_groups > 0 THEN
    RAISE EXCEPTION
      'PRC-H040: % student/day group(s) already have duplicate attendance rows; '
      'reconcile them before re-running',
      duplicate_groups;
  END IF;
END
$h040_preflight$;

-- 2) Drop an invalid leftover from an interrupted CONCURRENTLY build before
--    rebuilding (resume path). Plain DROP of an INVALID index is safe.
DO $drop_invalid_student_attendance_identity_uidx$
BEGIN
  IF EXISTS (
    SELECT 1
      FROM pg_class c
      JOIN pg_namespace n ON n.oid = c.relnamespace
      JOIN pg_index i ON i.indexrelid = c.oid
     WHERE n.nspname = 'public'
       AND c.relname = 'student_attendance_identity_uidx'
       AND NOT i.indisvalid
  ) THEN
    RAISE NOTICE 'dropping invalid student_attendance_identity_uidx before rebuild';
    EXECUTE 'DROP INDEX IF EXISTS public.student_attendance_identity_uidx';
  END IF;
END
$drop_invalid_student_attendance_identity_uidx$;

-- 3) The COALESCE unique index, built CONCURRENTLY.
CREATE UNIQUE INDEX CONCURRENTLY IF NOT EXISTS student_attendance_identity_uidx
  ON student_attendance (
    tenant_id, student_id, class_id, date,
    COALESCE(subject_id, '00000000-0000-0000-0000-000000000000'::uuid),
    COALESCE(period_id, '00000000-0000-0000-0000-000000000000'::uuid)
  );

-- 4) Present AND valid AND unique, or fail (skip when table absent).
DO $h040_assert$
BEGIN
  IF to_regclass('public.student_attendance') IS NULL THEN
    RETURN;
  END IF;
  IF NOT EXISTS (
    SELECT 1
      FROM pg_class c
      JOIN pg_namespace n ON n.oid = c.relnamespace
      JOIN pg_index i ON i.indexrelid = c.oid
     WHERE n.nspname = 'public'
       AND c.relname = 'student_attendance_identity_uidx'
       AND i.indisvalid
       AND i.indisunique
  ) THEN
    RAISE EXCEPTION 'PRC-H040: student_attendance_identity_uidx missing or not valid/unique';
  END IF;
END
$h040_assert$;
