-- PRC-H055: one academic record per (tenant, examination, student, subject).
--
-- publishResults wrote examination_academic_records with createMany (append
-- only) and had no natural key, so a re-publish / retry / concurrent publish
-- appended a second full set of rows per student/subject — downstream GPA and
-- transcript readers then saw duplicates. The service now upserts on this key
-- (idempotent re-publish); this migration is the DB backstop.
--
-- Prisma FORCE-RLS table. Transactional DDL. Additive and idempotent
-- (IF NOT EXISTS). tenant_id leads the key so cross-tenant rows stay
-- independent.
--
-- Data safety: existing duplicates are NOT deleted (grade records). The
-- preflight fails the apply with a count so an operator can reconcile first. A
-- new database has none.
-- Rollback: forward-only; a later migration may drop the index to relax.

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

CREATE UNIQUE INDEX IF NOT EXISTS examination_academic_records_identity_uidx
  ON examination_academic_records (tenant_id, examination_id, student_id, subject_id);

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
    RAISE EXCEPTION 'PRC-H055: examination_academic_records_identity_uidx missing or not unique';
  END IF;
END
$h055_assert$;

INSERT INTO schema_migrations (filename)
VALUES ('124_examination_academic_records_unique.sql')
ON CONFLICT (filename) DO NOTHING;
