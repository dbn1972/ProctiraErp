-- PRC-M197: one live scholarship application per applicant and programme.
--
-- ScholarshipService.submitApplication and the draft flow refuse a second
-- application from the same applicant to the same programme unless the
-- earlier one was withdrawn (findApplicationByApplicantAndProgram filters
-- status <> 'withdrawn'). That check-then-insert is not atomic, and direct
-- writes bypass it, so the database had no backstop.
--
-- Fix: a partial unique index on (tenant_id, program_id, applicant_id)
-- WHERE status <> 'withdrawn'. A duplicate raises 23505, which
-- PgScholarshipRepository maps to the same 409 the service already returns.
--
-- Non-transactional file: the index is built online (CONCURRENTLY) on an
-- existing table. Every statement is idempotent (apply-sql.sh phase ledger),
-- and apply-sql.sh records the file only after the last phase. Existing
-- duplicates are not deleted or edited: the preflight fails the apply with a
-- count so an operator can withdraw the extra applications first.
--
-- Rollback (forward migration): DROP INDEX
-- scholarship_applications_one_live_uidx; no data depends on it.
DO $m197_preflight$
DECLARE
  was_forced boolean;
  duplicate_groups bigint;
BEGIN
  SELECT relforcerowsecurity INTO was_forced
    FROM pg_class WHERE oid = 'public.scholarship_applications'::regclass;
  IF was_forced THEN
    ALTER TABLE scholarship_applications NO FORCE ROW LEVEL SECURITY;
  END IF;
  SELECT count(*) INTO duplicate_groups
    FROM (
      SELECT 1
        FROM scholarship_applications
       WHERE status <> 'withdrawn'
       GROUP BY tenant_id, program_id, applicant_id
      HAVING count(*) > 1
    ) d;
  IF was_forced THEN
    ALTER TABLE scholarship_applications FORCE ROW LEVEL SECURITY;
  END IF;
  IF duplicate_groups > 0 THEN
    RAISE EXCEPTION
      'PRC-M197: % applicant/programme pair(s) have more than one live application; '
      'withdraw the extra applications before re-running',
      duplicate_groups;
  END IF;
END
$m197_preflight$;
DO $m197_drop_invalid$
BEGIN
  IF EXISTS (
    SELECT 1
      FROM pg_class c
      JOIN pg_namespace n ON n.oid = c.relnamespace
      JOIN pg_index i ON i.indexrelid = c.oid
     WHERE n.nspname = 'public'
       AND c.relname = 'scholarship_applications_one_live_uidx'
       AND NOT i.indisvalid
  ) THEN
    EXECUTE 'DROP INDEX IF EXISTS public.scholarship_applications_one_live_uidx';
  END IF;
END
$m197_drop_invalid$;
CREATE UNIQUE INDEX CONCURRENTLY IF NOT EXISTS scholarship_applications_one_live_uidx
  ON scholarship_applications (tenant_id, program_id, applicant_id)
  WHERE status <> 'withdrawn';
DO $m197_assert$
BEGIN
  IF NOT EXISTS (
    SELECT 1
      FROM pg_class c
      JOIN pg_namespace n ON n.oid = c.relnamespace
      JOIN pg_index i ON i.indexrelid = c.oid
     WHERE n.nspname = 'public'
       AND c.relname = 'scholarship_applications_one_live_uidx'
       AND i.indisvalid
       AND i.indisunique
  ) THEN
    RAISE EXCEPTION 'PRC-M197: scholarship_applications_one_live_uidx missing or INVALID';
  END IF;
END
$m197_assert$;
