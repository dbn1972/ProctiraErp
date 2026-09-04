-- Phase 7: examination service-owned schema (charter §19).
-- Moves examination tables; drops tenant FKs.
-- student_id / academic_period_id / center_id / area_id / subject_id stay bare UUIDs.

CREATE SCHEMA IF NOT EXISTS examination;

DO $$
DECLARE r record;
BEGIN
  FOR r IN
    SELECT c.conname, n.nspname AS schema_name, t.relname AS table_name
    FROM pg_constraint c
    JOIN pg_class t ON t.oid = c.conrelid
    JOIN pg_namespace n ON n.oid = t.relnamespace
    JOIN pg_class ft ON ft.oid = c.confrelid
    JOIN pg_namespace fn ON fn.oid = ft.relnamespace
    WHERE c.contype = 'f'
      AND n.nspname = 'public'
      AND t.relname IN (
        'examinations',
        'examination_candidate_registrations',
        'examination_candidates',
        'examination_publications',
        'examination_result_analyses',
        'examination_academic_records',
        'examination_document_jobs'
      )
      AND (
        (ft.relname = 'tenants' AND fn.nspname IN ('public', 'platform'))
        OR ft.relname IN (
          'students', 'subjects', 'academic_periods', 'institutions',
          'geographic_areas', 'examinations'
        )
      )
  LOOP
    EXECUTE format('ALTER TABLE %I.%I DROP CONSTRAINT %I', r.schema_name, r.table_name, r.conname);
  END LOOP;
END $$;

ALTER TABLE IF EXISTS public.examinations SET SCHEMA examination;
ALTER TABLE IF EXISTS public.examination_candidate_registrations SET SCHEMA examination;
ALTER TABLE IF EXISTS public.examination_candidates SET SCHEMA examination;
ALTER TABLE IF EXISTS public.examination_publications SET SCHEMA examination;
ALTER TABLE IF EXISTS public.examination_result_analyses SET SCHEMA examination;
ALTER TABLE IF EXISTS public.examination_academic_records SET SCHEMA examination;
ALTER TABLE IF EXISTS public.examination_document_jobs SET SCHEMA examination;
