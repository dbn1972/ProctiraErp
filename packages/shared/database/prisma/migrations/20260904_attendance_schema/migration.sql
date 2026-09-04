-- Phase 5: attendance service-owned schema (charter §19).
-- Moves attendance tables; drops tenant FKs.
-- student_id / institution_id remain bare UUIDs — no FK/join into student or institution.

CREATE SCHEMA IF NOT EXISTS attendance;

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
      AND t.relname IN ('student_attendance', 'staff_attendance', 'attendance_audit')
      AND ft.relname = 'tenants'
      AND fn.nspname IN ('public', 'platform')
  LOOP
    EXECUTE format('ALTER TABLE %I.%I DROP CONSTRAINT %I', r.schema_name, r.table_name, r.conname);
  END LOOP;
END $$;

-- Drop any FK from attendance tables into students/institutions if present.
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
      AND t.relname IN ('student_attendance', 'staff_attendance', 'attendance_audit')
      AND ft.relname IN ('students', 'institutions', 'staff', 'classes', 'academic_periods')
  LOOP
    EXECUTE format('ALTER TABLE %I.%I DROP CONSTRAINT %I', r.schema_name, r.table_name, r.conname);
  END LOOP;
END $$;

ALTER TABLE IF EXISTS public.student_attendance SET SCHEMA attendance;
ALTER TABLE IF EXISTS public.staff_attendance SET SCHEMA attendance;
ALTER TABLE IF EXISTS public.attendance_audit SET SCHEMA attendance;
