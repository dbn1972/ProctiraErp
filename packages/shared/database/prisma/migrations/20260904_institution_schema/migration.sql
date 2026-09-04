-- Phase 3: institution service-owned schema (charter §19).
-- Moves institution-domain tables out of public; drops cross-schema FKs.
-- public.enrollments keeps institution_id / grade_id / class_id / academic_period_id as bare UUIDs.
-- institution.* keeps tenant_id as a bare UUID (no FK into platform.tenants).

CREATE SCHEMA IF NOT EXISTS institution;

-- Drop inbound FKs from public → institution-owned tables (esp. enrollments).
DO $$
DECLARE
  r record;
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
      AND ft.relname IN (
        'institutions', 'geographic_areas', 'boards', 'academic_periods',
        'grades', 'classes', 'subjects', 'institution_subjects'
      )
      AND fn.nspname IN ('public', 'institution')
  LOOP
    EXECUTE format('ALTER TABLE %I.%I DROP CONSTRAINT %I', r.schema_name, r.table_name, r.conname);
  END LOOP;
END $$;

-- Drop outbound FKs from institution-owned tables → platform/public tenants.
DO $$
DECLARE
  r record;
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
        'institutions', 'geographic_areas', 'boards', 'academic_periods',
        'grades', 'classes', 'subjects', 'institution_subjects'
      )
      AND ft.relname = 'tenants'
      AND fn.nspname IN ('public', 'platform')
  LOOP
    EXECUTE format('ALTER TABLE %I.%I DROP CONSTRAINT %I', r.schema_name, r.table_name, r.conname);
  END LOOP;
END $$;

-- Move board_type enum with boards (if still in public).
DO $$
BEGIN
  IF EXISTS (
    SELECT 1 FROM pg_type t
    JOIN pg_namespace n ON n.oid = t.typnamespace
    WHERE t.typname = 'board_type' AND n.nspname = 'public'
  ) THEN
    EXECUTE 'ALTER TYPE public.board_type SET SCHEMA institution';
  END IF;
END $$;

ALTER TABLE IF EXISTS public.geographic_areas SET SCHEMA institution;
ALTER TABLE IF EXISTS public.boards SET SCHEMA institution;
ALTER TABLE IF EXISTS public.institutions SET SCHEMA institution;
ALTER TABLE IF EXISTS public.academic_periods SET SCHEMA institution;
ALTER TABLE IF EXISTS public.grades SET SCHEMA institution;
ALTER TABLE IF EXISTS public.classes SET SCHEMA institution;
ALTER TABLE IF EXISTS public.subjects SET SCHEMA institution;
ALTER TABLE IF EXISTS public.institution_subjects SET SCHEMA institution;

-- Validation helpers (run on EC3):
--   SELECT nspname FROM pg_namespace WHERE nspname = 'institution';
--   SELECT count(*) FROM institution.institutions;
--   SELECT count(*) FROM pg_constraint c
--     JOIN pg_class t ON t.oid = c.conrelid
--     JOIN pg_namespace n ON n.oid = t.relnamespace
--     JOIN pg_class ft ON ft.oid = c.confrelid
--     JOIN pg_namespace fn ON fn.oid = ft.relnamespace
--    WHERE c.contype = 'f' AND n.nspname = 'institution'
--      AND fn.nspname IN ('public', 'platform');  -- expect 0 (except none to tenants)
--   -- public → institution FKs should also be 0
