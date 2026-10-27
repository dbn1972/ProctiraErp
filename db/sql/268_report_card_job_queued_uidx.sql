-- PRC-M166 (schema residual): ReportCardService reuses an in-flight job for the
-- same card (academics_batch2, report-card-service.ts findByStudentAndPeriod /
-- listByStatus, then create). That is check-then-insert: two concurrent requests
-- that both see no in-flight job each create a `queued` job for the same card.
-- The academics_batch2 disposition named the residual: "race-free de-dup across
-- concurrent requests needs a partial unique index on report_card_jobs".
--
--   report_card_jobs_queued_card_uidx
--     (tenant_id, student_id, academic_period_id, template_id, institution_id)
--     WHERE status = 'queued'
--
-- Only `queued` participates, so the existing behaviour for `processing` jobs
-- (reuse while fresh, a new job once abandoned past the stale window) and for
-- completed/failed history is unchanged. The PG repository maps this index's
-- 23505 to ConflictError; the service re-reads and reuses the queued job, so
-- the response shape (job / jobsCreated) is unchanged.
--
-- Shape (246/253): preflight duplicate count with FORCE RLS lifted and restored
-- inside one DO block, RAISE on duplicates (never delete data); drop an INVALID
-- leftover; CREATE UNIQUE INDEX CONCURRENTLY IF NOT EXISTS; assert valid +
-- unique. Every statement is idempotent; applied statement-by-statement via
-- schema_migration_phases.
-- Rollback (future forward migration):
--   DROP INDEX IF EXISTS report_card_jobs_queued_card_uidx;
DO $m166_preflight$
DECLARE
  was_forced boolean;
  duplicate_groups bigint;
BEGIN
  SELECT relforcerowsecurity INTO was_forced FROM pg_class WHERE oid = 'public.report_card_jobs'::regclass;
  IF was_forced THEN
    ALTER TABLE report_card_jobs NO FORCE ROW LEVEL SECURITY;
  END IF;
  SELECT count(*) INTO duplicate_groups
    FROM (
      SELECT tenant_id, student_id, academic_period_id, template_id, institution_id
        FROM report_card_jobs
       WHERE status = 'queued'
       GROUP BY tenant_id, student_id, academic_period_id, template_id, institution_id
      HAVING count(*) > 1
    ) d;
  IF was_forced THEN
    ALTER TABLE report_card_jobs FORCE ROW LEVEL SECURITY;
  END IF;
  IF duplicate_groups > 0 THEN
    RAISE EXCEPTION
      'PRC-M166: % card(s) have more than one queued report_card_jobs row; reconcile (fail or complete the extras) before re-running',
      duplicate_groups;
  END IF;
END
$m166_preflight$;
DO $m166_drop_invalid$
BEGIN
  IF EXISTS (
    SELECT 1
      FROM pg_class c
      JOIN pg_namespace n ON n.oid = c.relnamespace
      JOIN pg_index i ON i.indexrelid = c.oid
     WHERE n.nspname = 'public'
       AND c.relname = 'report_card_jobs_queued_card_uidx'
       AND NOT i.indisvalid
  ) THEN
    RAISE NOTICE 'dropping invalid report_card_jobs_queued_card_uidx before rebuild';
    EXECUTE 'DROP INDEX IF EXISTS public.report_card_jobs_queued_card_uidx';
  END IF;
END
$m166_drop_invalid$;
CREATE UNIQUE INDEX CONCURRENTLY IF NOT EXISTS report_card_jobs_queued_card_uidx
  ON report_card_jobs (tenant_id, student_id, academic_period_id, template_id, institution_id)
  WHERE status = 'queued';
DO $m166_assert$
BEGIN
  IF NOT EXISTS (
    SELECT 1
      FROM pg_class c
      JOIN pg_namespace n ON n.oid = c.relnamespace
      JOIN pg_index i ON i.indexrelid = c.oid
     WHERE n.nspname = 'public'
       AND c.relname = 'report_card_jobs_queued_card_uidx'
       AND i.indisvalid
       AND i.indisunique
  ) THEN
    RAISE EXCEPTION 'PRC-M166: report_card_jobs_queued_card_uidx missing or INVALID';
  END IF;
END
$m166_assert$;
