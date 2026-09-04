-- Phase 6: assessment service-owned schema (charter §19).
-- Moves continuous-assessment tables; drops tenant FKs.
-- subject_id / student_id / academic_period_id / grading_scheme_id stay bare UUIDs.

CREATE SCHEMA IF NOT EXISTS assessment;

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
        'grading_schemes', 'assessment_items',
        'assessment_outcomes', 'assessment_results'
      )
      AND (
        (ft.relname = 'tenants' AND fn.nspname IN ('public', 'platform'))
        OR ft.relname IN ('students', 'subjects', 'academic_periods', 'institutions')
      )
  LOOP
    EXECUTE format('ALTER TABLE %I.%I DROP CONSTRAINT %I', r.schema_name, r.table_name, r.conname);
  END LOOP;
END $$;

ALTER TABLE IF EXISTS public.grading_schemes SET SCHEMA assessment;
ALTER TABLE IF EXISTS public.assessment_items SET SCHEMA assessment;
ALTER TABLE IF EXISTS public.assessment_outcomes SET SCHEMA assessment;
ALTER TABLE IF EXISTS public.assessment_results SET SCHEMA assessment;
