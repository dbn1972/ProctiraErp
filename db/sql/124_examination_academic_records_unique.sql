-- PRC-H055: one academic record per (tenant, examination, student, subject).
--
-- publishResults wrote examination_academic_records with createMany (append
-- only) and had no natural key, so a re-publish / retry / concurrent publish
-- appended a second full set of rows per student/subject — downstream GPA and
-- transcript readers then saw duplicates. The service now upserts on this key
-- (idempotent re-publish); this migration is the DB backstop.
--
-- Prisma FORCE-RLS table. tenant_id leads the key so cross-tenant rows stay
-- independent.
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
-- Data safety: existing duplicates are NOT deleted (grade records). The
-- preflight fails the apply with a count so an operator can reconcile first. A
-- new database has none.
-- Rollback: forward-only; a later migration may drop the index to relax.

-- 1) Preflight: refuse to build over duplicates. Lift FORCE RLS for the owner
--    scan and restore it in the same block (atomic DO block).
DO $h055_preflight$
DECLARE
  was_forced boolean;
  duplicate_groups bigint;
BEGIN
  IF to_regclass('public.examination_academic_records') IS NULL THEN
    RAISE NOTICE 'PRC-H055: examination_academic_records missing; skipping';
    RETURN;
  END IF;
  SELECT relforcerowsecurity INTO was_forced
    FROM pg_class WHERE oid = 'public.examination_academic_records'::regclass;
  IF was_forced THEN
    ALTER TABLE examination_academic_records NO FORCE ROW LEVEL SECURITY;
  END IF;
  SELECT count(*) INTO duplicate_groups
    FROM (
      SELECT 1
        FROM examination_academic_records
       GROUP BY tenant_id, examination_id, student_id, subject_id
      HAVING count(*) > 1
    ) d;
  IF was_forced THEN
    ALTER TABLE examination_academic_records FORCE ROW LEVEL SECURITY;
  END IF;
  IF duplicate_groups > 0 THEN
    RAISE EXCEPTION
      'PRC-H055: % academic-record group(s) already have duplicates; '
      'reconcile them before re-running',
      duplicate_groups;
  END IF;
END
$h055_preflight$;

-- 2) Drop an invalid leftover from an interrupted CONCURRENTLY build before
--    rebuilding (resume path). Plain DROP of an INVALID index is safe.
DO $drop_invalid_examination_academic_records_identity_uidx$
BEGIN
  IF EXISTS (
    SELECT 1
      FROM pg_class c
      JOIN pg_namespace n ON n.oid = c.relnamespace
      JOIN pg_index i ON i.indexrelid = c.oid
     WHERE n.nspname = 'public'
       AND c.relname = 'examination_academic_records_identity_uidx'
       AND NOT i.indisvalid
  ) THEN
    RAISE NOTICE 'dropping invalid examination_academic_records_identity_uidx before rebuild';
    EXECUTE 'DROP INDEX IF EXISTS public.examination_academic_records_identity_uidx';
  END IF;
END
$drop_invalid_examination_academic_records_identity_uidx$;

-- 3) The unique index, built CONCURRENTLY.
CREATE UNIQUE INDEX CONCURRENTLY IF NOT EXISTS examination_academic_records_identity_uidx
  ON examination_academic_records (tenant_id, examination_id, student_id, subject_id);

-- 4) Present AND valid AND unique, or fail (skip when table absent).
DO $h055_assert$
BEGIN
  IF to_regclass('public.examination_academic_records') IS NULL THEN
    RETURN;
  END IF;
  IF NOT EXISTS (
    SELECT 1
      FROM pg_class c
      JOIN pg_namespace n ON n.oid = c.relnamespace
      JOIN pg_index i ON i.indexrelid = c.oid
     WHERE n.nspname = 'public'
       AND c.relname = 'examination_academic_records_identity_uidx'
       AND i.indisvalid
       AND i.indisunique
  ) THEN
    RAISE EXCEPTION 'PRC-H055: examination_academic_records_identity_uidx missing or not valid/unique';
  END IF;
END
$h055_assert$;
