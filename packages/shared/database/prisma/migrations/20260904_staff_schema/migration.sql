-- Phase 8: staff service-owned schema (charter §19).
-- Moves staff tables; drops tenant FKs.
-- staff_id / institution_id / subject_id / class_id stay bare UUIDs.

CREATE SCHEMA IF NOT EXISTS staff;

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
      AND t.relname IN ('staff', 'staff_assignments')
      AND (
        (ft.relname = 'tenants' AND fn.nspname IN ('public', 'platform'))
        OR ft.relname IN (
          'staff', 'institutions', 'subjects', 'classes', 'academic_periods'
        )
      )
  LOOP
    EXECUTE format('ALTER TABLE %I.%I DROP CONSTRAINT %I', r.schema_name, r.table_name, r.conname);
  END LOOP;
END $$;

ALTER TABLE IF EXISTS public.staff SET SCHEMA staff;
ALTER TABLE IF EXISTS public.staff_assignments SET SCHEMA staff;
