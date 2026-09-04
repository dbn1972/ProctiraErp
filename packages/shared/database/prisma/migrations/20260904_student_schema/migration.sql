-- Phase 4: student service-owned schema (charter §19).
-- Moves student-domain tables out of public; drops tenant FKs.
-- Enrollment↔Student FK retained inside student schema.
-- institution_id / grade_id / class_id / academic_period_id stay bare UUIDs (Phase 3).

CREATE SCHEMA IF NOT EXISTS student;

-- Drop inbound FKs from public into student-owned tables (if any remain).
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
      AND ft.relname IN ('students', 'enrollments', 'enrollment_history', 'student_transfers')
      AND fn.nspname IN ('public', 'student')
      AND t.relname NOT IN ('students', 'enrollments', 'enrollment_history', 'student_transfers')
  LOOP
    EXECUTE format('ALTER TABLE %I.%I DROP CONSTRAINT %I', r.schema_name, r.table_name, r.conname);
  END LOOP;
END $$;

-- Drop outbound FKs from student-owned tables → platform/public tenants.
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
      AND t.relname IN ('students', 'enrollments', 'enrollment_history', 'student_transfers')
      AND ft.relname = 'tenants'
      AND fn.nspname IN ('public', 'platform')
  LOOP
    EXECUTE format('ALTER TABLE %I.%I DROP CONSTRAINT %I', r.schema_name, r.table_name, r.conname);
  END LOOP;
END $$;

-- Move enrollment_status enum with enrollments.
DO $$
BEGIN
  IF EXISTS (
    SELECT 1 FROM pg_type t
    JOIN pg_namespace n ON n.oid = t.typnamespace
    WHERE t.typname = 'enrollment_status' AND n.nspname = 'public'
  ) THEN
    EXECUTE 'ALTER TYPE public.enrollment_status SET SCHEMA student';
  END IF;
END $$;

ALTER TABLE IF EXISTS public.students SET SCHEMA student;
ALTER TABLE IF EXISTS public.enrollments SET SCHEMA student;
ALTER TABLE IF EXISTS public.enrollment_history SET SCHEMA student;
ALTER TABLE IF EXISTS public.student_transfers SET SCHEMA student;
