-- PR B1 (FKB-009..FKB-105, academic): parent-side UNIQUE (tenant_id, id)
-- indexes on the 18 academic parents that do not have one yet, so their child
-- tables can carry tenant-composite (tenant_id, <fk>) -> parent (tenant_id, id)
-- foreign keys. db/sql/307 adds those FKs and validates them.
--
-- Why: the 33 academic child -> parent FKs listed in db/sql/307 are id-only
-- (`<col> REFERENCES <parent>(id)`, db/sql/001, 003, 021, 024, 027, 036, 071,
-- 076, 090, 106, 111, 122, 230). The RI check runs as the table owner and
-- ignores RLS, so a tenant-A row could point at a tenant-B board, area,
-- student, section, bell period, room or subject (live probe: 201/200/202 on
-- the timetable, gradebook, institution and report-card writers), and an
-- ON DELETE CASCADE from tenant B's parent could delete tenant A's rows. A
-- composite FK needs a unique index whose columns are exactly (tenant_id, id)
-- on the parent. These 18 parents have none:
--   assessment_items, bell_periods, bell_schedules, boards, enrollments,
--   exam_sessions, examinations, geographic_areas, grade_entries,
--   grading_scales, grading_schemes, institution_infrastructure,
--   report_card_templates, rooms, section_meetings, sections,
--   student_consents, transcript_signing_keys.
-- (students, staff and subjects already have <parent>_tenant_id_id_uidx from
-- db/sql/254.) `id` is the primary key of every parent, so the pair is unique
-- by construction and no duplicate preflight is needed.
--
-- Same pattern as db/sql/254 and db/sql/303: a unique index build without a
-- table lock cannot run inside a transaction, so apply-sql.sh applies this file
-- statement-by-statement through the schema_migration_phases ledger. Every
-- statement is idempotent compensating-forward DDL: (1) drop an INVALID
-- leftover from an interrupted build, (2) build, (3) assert present + valid +
-- unique. Lock: SHARE UPDATE EXCLUSIVE per parent for the build only (reads and
-- writes continue). apply-sql.sh's lock_timeout / statement_timeout apply.
--
-- Rollback (forward-only repo; body of a future revert migration, after the
-- db/sql/307 composite FKs that depend on these indexes are dropped):
--   DROP INDEX IF EXISTS <parent>_tenant_id_id_uidx;  -- for each parent above
-- Data loss on rollback: none (index only).
-- assessment_items
DO $drop_invalid_assessment_items_tenant_id_id_uidx$
BEGIN
  IF EXISTS (
    SELECT 1
      FROM pg_class c
      JOIN pg_namespace n ON n.oid = c.relnamespace
      JOIN pg_index i ON i.indexrelid = c.oid
     WHERE n.nspname = 'public'
       AND c.relname = 'assessment_items_tenant_id_id_uidx'
       AND NOT i.indisvalid
  ) THEN
    RAISE NOTICE 'dropping invalid assessment_items_tenant_id_id_uidx before rebuild';
    EXECUTE 'DROP INDEX IF EXISTS public.assessment_items_tenant_id_id_uidx';
  END IF;
END
$drop_invalid_assessment_items_tenant_id_id_uidx$;
CREATE UNIQUE INDEX CONCURRENTLY IF NOT EXISTS assessment_items_tenant_id_id_uidx
  ON assessment_items (tenant_id, id);
DO $assert_assessment_items_tenant_id_id_uidx$
BEGIN
  IF NOT EXISTS (
    SELECT 1
      FROM pg_class c
      JOIN pg_namespace n ON n.oid = c.relnamespace
      JOIN pg_index i ON i.indexrelid = c.oid
     WHERE n.nspname = 'public'
       AND c.relname = 'assessment_items_tenant_id_id_uidx'
       AND i.indrelid = 'public.assessment_items'::regclass
       AND i.indisvalid
       AND i.indisunique
       AND i.indnkeyatts = 2
  ) THEN
    RAISE EXCEPTION 'B1: assessment_items_tenant_id_id_uidx missing or not valid/unique';
  END IF;
END
$assert_assessment_items_tenant_id_id_uidx$;
-- bell_periods
DO $drop_invalid_bell_periods_tenant_id_id_uidx$
BEGIN
  IF EXISTS (
    SELECT 1
      FROM pg_class c
      JOIN pg_namespace n ON n.oid = c.relnamespace
      JOIN pg_index i ON i.indexrelid = c.oid
     WHERE n.nspname = 'public'
       AND c.relname = 'bell_periods_tenant_id_id_uidx'
       AND NOT i.indisvalid
  ) THEN
    RAISE NOTICE 'dropping invalid bell_periods_tenant_id_id_uidx before rebuild';
    EXECUTE 'DROP INDEX IF EXISTS public.bell_periods_tenant_id_id_uidx';
  END IF;
END
$drop_invalid_bell_periods_tenant_id_id_uidx$;
CREATE UNIQUE INDEX CONCURRENTLY IF NOT EXISTS bell_periods_tenant_id_id_uidx
  ON bell_periods (tenant_id, id);
DO $assert_bell_periods_tenant_id_id_uidx$
BEGIN
  IF NOT EXISTS (
    SELECT 1
      FROM pg_class c
      JOIN pg_namespace n ON n.oid = c.relnamespace
      JOIN pg_index i ON i.indexrelid = c.oid
     WHERE n.nspname = 'public'
       AND c.relname = 'bell_periods_tenant_id_id_uidx'
       AND i.indrelid = 'public.bell_periods'::regclass
       AND i.indisvalid
       AND i.indisunique
       AND i.indnkeyatts = 2
  ) THEN
    RAISE EXCEPTION 'B1: bell_periods_tenant_id_id_uidx missing or not valid/unique';
  END IF;
END
$assert_bell_periods_tenant_id_id_uidx$;
-- bell_schedules
DO $drop_invalid_bell_schedules_tenant_id_id_uidx$
BEGIN
  IF EXISTS (
    SELECT 1
      FROM pg_class c
      JOIN pg_namespace n ON n.oid = c.relnamespace
      JOIN pg_index i ON i.indexrelid = c.oid
     WHERE n.nspname = 'public'
       AND c.relname = 'bell_schedules_tenant_id_id_uidx'
       AND NOT i.indisvalid
  ) THEN
    RAISE NOTICE 'dropping invalid bell_schedules_tenant_id_id_uidx before rebuild';
    EXECUTE 'DROP INDEX IF EXISTS public.bell_schedules_tenant_id_id_uidx';
  END IF;
END
$drop_invalid_bell_schedules_tenant_id_id_uidx$;
CREATE UNIQUE INDEX CONCURRENTLY IF NOT EXISTS bell_schedules_tenant_id_id_uidx
  ON bell_schedules (tenant_id, id);
DO $assert_bell_schedules_tenant_id_id_uidx$
BEGIN
  IF NOT EXISTS (
    SELECT 1
      FROM pg_class c
      JOIN pg_namespace n ON n.oid = c.relnamespace
      JOIN pg_index i ON i.indexrelid = c.oid
     WHERE n.nspname = 'public'
       AND c.relname = 'bell_schedules_tenant_id_id_uidx'
       AND i.indrelid = 'public.bell_schedules'::regclass
       AND i.indisvalid
       AND i.indisunique
       AND i.indnkeyatts = 2
  ) THEN
    RAISE EXCEPTION 'B1: bell_schedules_tenant_id_id_uidx missing or not valid/unique';
  END IF;
END
$assert_bell_schedules_tenant_id_id_uidx$;
-- boards
DO $drop_invalid_boards_tenant_id_id_uidx$
BEGIN
  IF EXISTS (
    SELECT 1
      FROM pg_class c
      JOIN pg_namespace n ON n.oid = c.relnamespace
      JOIN pg_index i ON i.indexrelid = c.oid
     WHERE n.nspname = 'public'
       AND c.relname = 'boards_tenant_id_id_uidx'
       AND NOT i.indisvalid
  ) THEN
    RAISE NOTICE 'dropping invalid boards_tenant_id_id_uidx before rebuild';
    EXECUTE 'DROP INDEX IF EXISTS public.boards_tenant_id_id_uidx';
  END IF;
END
$drop_invalid_boards_tenant_id_id_uidx$;
CREATE UNIQUE INDEX CONCURRENTLY IF NOT EXISTS boards_tenant_id_id_uidx
  ON boards (tenant_id, id);
DO $assert_boards_tenant_id_id_uidx$
BEGIN
  IF NOT EXISTS (
    SELECT 1
      FROM pg_class c
      JOIN pg_namespace n ON n.oid = c.relnamespace
      JOIN pg_index i ON i.indexrelid = c.oid
     WHERE n.nspname = 'public'
       AND c.relname = 'boards_tenant_id_id_uidx'
       AND i.indrelid = 'public.boards'::regclass
       AND i.indisvalid
       AND i.indisunique
       AND i.indnkeyatts = 2
  ) THEN
    RAISE EXCEPTION 'B1: boards_tenant_id_id_uidx missing or not valid/unique';
  END IF;
END
$assert_boards_tenant_id_id_uidx$;
-- enrollments
DO $drop_invalid_enrollments_tenant_id_id_uidx$
BEGIN
  IF EXISTS (
    SELECT 1
      FROM pg_class c
      JOIN pg_namespace n ON n.oid = c.relnamespace
      JOIN pg_index i ON i.indexrelid = c.oid
     WHERE n.nspname = 'public'
       AND c.relname = 'enrollments_tenant_id_id_uidx'
       AND NOT i.indisvalid
  ) THEN
    RAISE NOTICE 'dropping invalid enrollments_tenant_id_id_uidx before rebuild';
    EXECUTE 'DROP INDEX IF EXISTS public.enrollments_tenant_id_id_uidx';
  END IF;
END
$drop_invalid_enrollments_tenant_id_id_uidx$;
CREATE UNIQUE INDEX CONCURRENTLY IF NOT EXISTS enrollments_tenant_id_id_uidx
  ON enrollments (tenant_id, id);
DO $assert_enrollments_tenant_id_id_uidx$
BEGIN
  IF NOT EXISTS (
    SELECT 1
      FROM pg_class c
      JOIN pg_namespace n ON n.oid = c.relnamespace
      JOIN pg_index i ON i.indexrelid = c.oid
     WHERE n.nspname = 'public'
       AND c.relname = 'enrollments_tenant_id_id_uidx'
       AND i.indrelid = 'public.enrollments'::regclass
       AND i.indisvalid
       AND i.indisunique
       AND i.indnkeyatts = 2
  ) THEN
    RAISE EXCEPTION 'B1: enrollments_tenant_id_id_uidx missing or not valid/unique';
  END IF;
END
$assert_enrollments_tenant_id_id_uidx$;
-- exam_sessions
DO $drop_invalid_exam_sessions_tenant_id_id_uidx$
BEGIN
  IF EXISTS (
    SELECT 1
      FROM pg_class c
      JOIN pg_namespace n ON n.oid = c.relnamespace
      JOIN pg_index i ON i.indexrelid = c.oid
     WHERE n.nspname = 'public'
       AND c.relname = 'exam_sessions_tenant_id_id_uidx'
       AND NOT i.indisvalid
  ) THEN
    RAISE NOTICE 'dropping invalid exam_sessions_tenant_id_id_uidx before rebuild';
    EXECUTE 'DROP INDEX IF EXISTS public.exam_sessions_tenant_id_id_uidx';
  END IF;
END
$drop_invalid_exam_sessions_tenant_id_id_uidx$;
CREATE UNIQUE INDEX CONCURRENTLY IF NOT EXISTS exam_sessions_tenant_id_id_uidx
  ON exam_sessions (tenant_id, id);
DO $assert_exam_sessions_tenant_id_id_uidx$
BEGIN
  IF NOT EXISTS (
    SELECT 1
      FROM pg_class c
      JOIN pg_namespace n ON n.oid = c.relnamespace
      JOIN pg_index i ON i.indexrelid = c.oid
     WHERE n.nspname = 'public'
       AND c.relname = 'exam_sessions_tenant_id_id_uidx'
       AND i.indrelid = 'public.exam_sessions'::regclass
       AND i.indisvalid
       AND i.indisunique
       AND i.indnkeyatts = 2
  ) THEN
    RAISE EXCEPTION 'B1: exam_sessions_tenant_id_id_uidx missing or not valid/unique';
  END IF;
END
$assert_exam_sessions_tenant_id_id_uidx$;
-- examinations
DO $drop_invalid_examinations_tenant_id_id_uidx$
BEGIN
  IF EXISTS (
    SELECT 1
      FROM pg_class c
      JOIN pg_namespace n ON n.oid = c.relnamespace
      JOIN pg_index i ON i.indexrelid = c.oid
     WHERE n.nspname = 'public'
       AND c.relname = 'examinations_tenant_id_id_uidx'
       AND NOT i.indisvalid
  ) THEN
    RAISE NOTICE 'dropping invalid examinations_tenant_id_id_uidx before rebuild';
    EXECUTE 'DROP INDEX IF EXISTS public.examinations_tenant_id_id_uidx';
  END IF;
END
$drop_invalid_examinations_tenant_id_id_uidx$;
CREATE UNIQUE INDEX CONCURRENTLY IF NOT EXISTS examinations_tenant_id_id_uidx
  ON examinations (tenant_id, id);
DO $assert_examinations_tenant_id_id_uidx$
BEGIN
  IF NOT EXISTS (
    SELECT 1
      FROM pg_class c
      JOIN pg_namespace n ON n.oid = c.relnamespace
      JOIN pg_index i ON i.indexrelid = c.oid
     WHERE n.nspname = 'public'
       AND c.relname = 'examinations_tenant_id_id_uidx'
       AND i.indrelid = 'public.examinations'::regclass
       AND i.indisvalid
       AND i.indisunique
       AND i.indnkeyatts = 2
  ) THEN
    RAISE EXCEPTION 'B1: examinations_tenant_id_id_uidx missing or not valid/unique';
  END IF;
END
$assert_examinations_tenant_id_id_uidx$;
-- geographic_areas
DO $drop_invalid_geographic_areas_tenant_id_id_uidx$
BEGIN
  IF EXISTS (
    SELECT 1
      FROM pg_class c
      JOIN pg_namespace n ON n.oid = c.relnamespace
      JOIN pg_index i ON i.indexrelid = c.oid
     WHERE n.nspname = 'public'
       AND c.relname = 'geographic_areas_tenant_id_id_uidx'
       AND NOT i.indisvalid
  ) THEN
    RAISE NOTICE 'dropping invalid geographic_areas_tenant_id_id_uidx before rebuild';
    EXECUTE 'DROP INDEX IF EXISTS public.geographic_areas_tenant_id_id_uidx';
  END IF;
END
$drop_invalid_geographic_areas_tenant_id_id_uidx$;
CREATE UNIQUE INDEX CONCURRENTLY IF NOT EXISTS geographic_areas_tenant_id_id_uidx
  ON geographic_areas (tenant_id, id);
DO $assert_geographic_areas_tenant_id_id_uidx$
BEGIN
  IF NOT EXISTS (
    SELECT 1
      FROM pg_class c
      JOIN pg_namespace n ON n.oid = c.relnamespace
      JOIN pg_index i ON i.indexrelid = c.oid
     WHERE n.nspname = 'public'
       AND c.relname = 'geographic_areas_tenant_id_id_uidx'
       AND i.indrelid = 'public.geographic_areas'::regclass
       AND i.indisvalid
       AND i.indisunique
       AND i.indnkeyatts = 2
  ) THEN
    RAISE EXCEPTION 'B1: geographic_areas_tenant_id_id_uidx missing or not valid/unique';
  END IF;
END
$assert_geographic_areas_tenant_id_id_uidx$;
-- grade_entries
DO $drop_invalid_grade_entries_tenant_id_id_uidx$
BEGIN
  IF EXISTS (
    SELECT 1
      FROM pg_class c
      JOIN pg_namespace n ON n.oid = c.relnamespace
      JOIN pg_index i ON i.indexrelid = c.oid
     WHERE n.nspname = 'public'
       AND c.relname = 'grade_entries_tenant_id_id_uidx'
       AND NOT i.indisvalid
  ) THEN
    RAISE NOTICE 'dropping invalid grade_entries_tenant_id_id_uidx before rebuild';
    EXECUTE 'DROP INDEX IF EXISTS public.grade_entries_tenant_id_id_uidx';
  END IF;
END
$drop_invalid_grade_entries_tenant_id_id_uidx$;
CREATE UNIQUE INDEX CONCURRENTLY IF NOT EXISTS grade_entries_tenant_id_id_uidx
  ON grade_entries (tenant_id, id);
DO $assert_grade_entries_tenant_id_id_uidx$
BEGIN
  IF NOT EXISTS (
    SELECT 1
      FROM pg_class c
      JOIN pg_namespace n ON n.oid = c.relnamespace
      JOIN pg_index i ON i.indexrelid = c.oid
     WHERE n.nspname = 'public'
       AND c.relname = 'grade_entries_tenant_id_id_uidx'
       AND i.indrelid = 'public.grade_entries'::regclass
       AND i.indisvalid
       AND i.indisunique
       AND i.indnkeyatts = 2
  ) THEN
    RAISE EXCEPTION 'B1: grade_entries_tenant_id_id_uidx missing or not valid/unique';
  END IF;
END
$assert_grade_entries_tenant_id_id_uidx$;
-- grading_scales
DO $drop_invalid_grading_scales_tenant_id_id_uidx$
BEGIN
  IF EXISTS (
    SELECT 1
      FROM pg_class c
      JOIN pg_namespace n ON n.oid = c.relnamespace
      JOIN pg_index i ON i.indexrelid = c.oid
     WHERE n.nspname = 'public'
       AND c.relname = 'grading_scales_tenant_id_id_uidx'
       AND NOT i.indisvalid
  ) THEN
    RAISE NOTICE 'dropping invalid grading_scales_tenant_id_id_uidx before rebuild';
    EXECUTE 'DROP INDEX IF EXISTS public.grading_scales_tenant_id_id_uidx';
  END IF;
END
$drop_invalid_grading_scales_tenant_id_id_uidx$;
CREATE UNIQUE INDEX CONCURRENTLY IF NOT EXISTS grading_scales_tenant_id_id_uidx
  ON grading_scales (tenant_id, id);
DO $assert_grading_scales_tenant_id_id_uidx$
BEGIN
  IF NOT EXISTS (
    SELECT 1
      FROM pg_class c
      JOIN pg_namespace n ON n.oid = c.relnamespace
      JOIN pg_index i ON i.indexrelid = c.oid
     WHERE n.nspname = 'public'
       AND c.relname = 'grading_scales_tenant_id_id_uidx'
       AND i.indrelid = 'public.grading_scales'::regclass
       AND i.indisvalid
       AND i.indisunique
       AND i.indnkeyatts = 2
  ) THEN
    RAISE EXCEPTION 'B1: grading_scales_tenant_id_id_uidx missing or not valid/unique';
  END IF;
END
$assert_grading_scales_tenant_id_id_uidx$;
-- grading_schemes
DO $drop_invalid_grading_schemes_tenant_id_id_uidx$
BEGIN
  IF EXISTS (
    SELECT 1
      FROM pg_class c
      JOIN pg_namespace n ON n.oid = c.relnamespace
      JOIN pg_index i ON i.indexrelid = c.oid
     WHERE n.nspname = 'public'
       AND c.relname = 'grading_schemes_tenant_id_id_uidx'
       AND NOT i.indisvalid
  ) THEN
    RAISE NOTICE 'dropping invalid grading_schemes_tenant_id_id_uidx before rebuild';
    EXECUTE 'DROP INDEX IF EXISTS public.grading_schemes_tenant_id_id_uidx';
  END IF;
END
$drop_invalid_grading_schemes_tenant_id_id_uidx$;
CREATE UNIQUE INDEX CONCURRENTLY IF NOT EXISTS grading_schemes_tenant_id_id_uidx
  ON grading_schemes (tenant_id, id);
DO $assert_grading_schemes_tenant_id_id_uidx$
BEGIN
  IF NOT EXISTS (
    SELECT 1
      FROM pg_class c
      JOIN pg_namespace n ON n.oid = c.relnamespace
      JOIN pg_index i ON i.indexrelid = c.oid
     WHERE n.nspname = 'public'
       AND c.relname = 'grading_schemes_tenant_id_id_uidx'
       AND i.indrelid = 'public.grading_schemes'::regclass
       AND i.indisvalid
       AND i.indisunique
       AND i.indnkeyatts = 2
  ) THEN
    RAISE EXCEPTION 'B1: grading_schemes_tenant_id_id_uidx missing or not valid/unique';
  END IF;
END
$assert_grading_schemes_tenant_id_id_uidx$;
-- institution_infrastructure
DO $drop_invalid_institution_infrastructure_tenant_id_id_uidx$
BEGIN
  IF EXISTS (
    SELECT 1
      FROM pg_class c
      JOIN pg_namespace n ON n.oid = c.relnamespace
      JOIN pg_index i ON i.indexrelid = c.oid
     WHERE n.nspname = 'public'
       AND c.relname = 'institution_infrastructure_tenant_id_id_uidx'
       AND NOT i.indisvalid
  ) THEN
    RAISE NOTICE 'dropping invalid institution_infrastructure_tenant_id_id_uidx before rebuild';
    EXECUTE 'DROP INDEX IF EXISTS public.institution_infrastructure_tenant_id_id_uidx';
  END IF;
END
$drop_invalid_institution_infrastructure_tenant_id_id_uidx$;
CREATE UNIQUE INDEX CONCURRENTLY IF NOT EXISTS institution_infrastructure_tenant_id_id_uidx
  ON institution_infrastructure (tenant_id, id);
DO $assert_institution_infrastructure_tenant_id_id_uidx$
BEGIN
  IF NOT EXISTS (
    SELECT 1
      FROM pg_class c
      JOIN pg_namespace n ON n.oid = c.relnamespace
      JOIN pg_index i ON i.indexrelid = c.oid
     WHERE n.nspname = 'public'
       AND c.relname = 'institution_infrastructure_tenant_id_id_uidx'
       AND i.indrelid = 'public.institution_infrastructure'::regclass
       AND i.indisvalid
       AND i.indisunique
       AND i.indnkeyatts = 2
  ) THEN
    RAISE EXCEPTION 'B1: institution_infrastructure_tenant_id_id_uidx missing or not valid/unique';
  END IF;
END
$assert_institution_infrastructure_tenant_id_id_uidx$;
-- report_card_templates
DO $drop_invalid_report_card_templates_tenant_id_id_uidx$
BEGIN
  IF EXISTS (
    SELECT 1
      FROM pg_class c
      JOIN pg_namespace n ON n.oid = c.relnamespace
      JOIN pg_index i ON i.indexrelid = c.oid
     WHERE n.nspname = 'public'
       AND c.relname = 'report_card_templates_tenant_id_id_uidx'
       AND NOT i.indisvalid
  ) THEN
    RAISE NOTICE 'dropping invalid report_card_templates_tenant_id_id_uidx before rebuild';
    EXECUTE 'DROP INDEX IF EXISTS public.report_card_templates_tenant_id_id_uidx';
  END IF;
END
$drop_invalid_report_card_templates_tenant_id_id_uidx$;
CREATE UNIQUE INDEX CONCURRENTLY IF NOT EXISTS report_card_templates_tenant_id_id_uidx
  ON report_card_templates (tenant_id, id);
DO $assert_report_card_templates_tenant_id_id_uidx$
BEGIN
  IF NOT EXISTS (
    SELECT 1
      FROM pg_class c
      JOIN pg_namespace n ON n.oid = c.relnamespace
      JOIN pg_index i ON i.indexrelid = c.oid
     WHERE n.nspname = 'public'
       AND c.relname = 'report_card_templates_tenant_id_id_uidx'
       AND i.indrelid = 'public.report_card_templates'::regclass
       AND i.indisvalid
       AND i.indisunique
       AND i.indnkeyatts = 2
  ) THEN
    RAISE EXCEPTION 'B1: report_card_templates_tenant_id_id_uidx missing or not valid/unique';
  END IF;
END
$assert_report_card_templates_tenant_id_id_uidx$;
-- rooms
DO $drop_invalid_rooms_tenant_id_id_uidx$
BEGIN
  IF EXISTS (
    SELECT 1
      FROM pg_class c
      JOIN pg_namespace n ON n.oid = c.relnamespace
      JOIN pg_index i ON i.indexrelid = c.oid
     WHERE n.nspname = 'public'
       AND c.relname = 'rooms_tenant_id_id_uidx'
       AND NOT i.indisvalid
  ) THEN
    RAISE NOTICE 'dropping invalid rooms_tenant_id_id_uidx before rebuild';
    EXECUTE 'DROP INDEX IF EXISTS public.rooms_tenant_id_id_uidx';
  END IF;
END
$drop_invalid_rooms_tenant_id_id_uidx$;
CREATE UNIQUE INDEX CONCURRENTLY IF NOT EXISTS rooms_tenant_id_id_uidx
  ON rooms (tenant_id, id);
DO $assert_rooms_tenant_id_id_uidx$
BEGIN
  IF NOT EXISTS (
    SELECT 1
      FROM pg_class c
      JOIN pg_namespace n ON n.oid = c.relnamespace
      JOIN pg_index i ON i.indexrelid = c.oid
     WHERE n.nspname = 'public'
       AND c.relname = 'rooms_tenant_id_id_uidx'
       AND i.indrelid = 'public.rooms'::regclass
       AND i.indisvalid
       AND i.indisunique
       AND i.indnkeyatts = 2
  ) THEN
    RAISE EXCEPTION 'B1: rooms_tenant_id_id_uidx missing or not valid/unique';
  END IF;
END
$assert_rooms_tenant_id_id_uidx$;
-- section_meetings
DO $drop_invalid_section_meetings_tenant_id_id_uidx$
BEGIN
  IF EXISTS (
    SELECT 1
      FROM pg_class c
      JOIN pg_namespace n ON n.oid = c.relnamespace
      JOIN pg_index i ON i.indexrelid = c.oid
     WHERE n.nspname = 'public'
       AND c.relname = 'section_meetings_tenant_id_id_uidx'
       AND NOT i.indisvalid
  ) THEN
    RAISE NOTICE 'dropping invalid section_meetings_tenant_id_id_uidx before rebuild';
    EXECUTE 'DROP INDEX IF EXISTS public.section_meetings_tenant_id_id_uidx';
  END IF;
END
$drop_invalid_section_meetings_tenant_id_id_uidx$;
CREATE UNIQUE INDEX CONCURRENTLY IF NOT EXISTS section_meetings_tenant_id_id_uidx
  ON section_meetings (tenant_id, id);
DO $assert_section_meetings_tenant_id_id_uidx$
BEGIN
  IF NOT EXISTS (
    SELECT 1
      FROM pg_class c
      JOIN pg_namespace n ON n.oid = c.relnamespace
      JOIN pg_index i ON i.indexrelid = c.oid
     WHERE n.nspname = 'public'
       AND c.relname = 'section_meetings_tenant_id_id_uidx'
       AND i.indrelid = 'public.section_meetings'::regclass
       AND i.indisvalid
       AND i.indisunique
       AND i.indnkeyatts = 2
  ) THEN
    RAISE EXCEPTION 'B1: section_meetings_tenant_id_id_uidx missing or not valid/unique';
  END IF;
END
$assert_section_meetings_tenant_id_id_uidx$;
-- sections
DO $drop_invalid_sections_tenant_id_id_uidx$
BEGIN
  IF EXISTS (
    SELECT 1
      FROM pg_class c
      JOIN pg_namespace n ON n.oid = c.relnamespace
      JOIN pg_index i ON i.indexrelid = c.oid
     WHERE n.nspname = 'public'
       AND c.relname = 'sections_tenant_id_id_uidx'
       AND NOT i.indisvalid
  ) THEN
    RAISE NOTICE 'dropping invalid sections_tenant_id_id_uidx before rebuild';
    EXECUTE 'DROP INDEX IF EXISTS public.sections_tenant_id_id_uidx';
  END IF;
END
$drop_invalid_sections_tenant_id_id_uidx$;
CREATE UNIQUE INDEX CONCURRENTLY IF NOT EXISTS sections_tenant_id_id_uidx
  ON sections (tenant_id, id);
DO $assert_sections_tenant_id_id_uidx$
BEGIN
  IF NOT EXISTS (
    SELECT 1
      FROM pg_class c
      JOIN pg_namespace n ON n.oid = c.relnamespace
      JOIN pg_index i ON i.indexrelid = c.oid
     WHERE n.nspname = 'public'
       AND c.relname = 'sections_tenant_id_id_uidx'
       AND i.indrelid = 'public.sections'::regclass
       AND i.indisvalid
       AND i.indisunique
       AND i.indnkeyatts = 2
  ) THEN
    RAISE EXCEPTION 'B1: sections_tenant_id_id_uidx missing or not valid/unique';
  END IF;
END
$assert_sections_tenant_id_id_uidx$;
-- student_consents
DO $drop_invalid_student_consents_tenant_id_id_uidx$
BEGIN
  IF EXISTS (
    SELECT 1
      FROM pg_class c
      JOIN pg_namespace n ON n.oid = c.relnamespace
      JOIN pg_index i ON i.indexrelid = c.oid
     WHERE n.nspname = 'public'
       AND c.relname = 'student_consents_tenant_id_id_uidx'
       AND NOT i.indisvalid
  ) THEN
    RAISE NOTICE 'dropping invalid student_consents_tenant_id_id_uidx before rebuild';
    EXECUTE 'DROP INDEX IF EXISTS public.student_consents_tenant_id_id_uidx';
  END IF;
END
$drop_invalid_student_consents_tenant_id_id_uidx$;
CREATE UNIQUE INDEX CONCURRENTLY IF NOT EXISTS student_consents_tenant_id_id_uidx
  ON student_consents (tenant_id, id);
DO $assert_student_consents_tenant_id_id_uidx$
BEGIN
  IF NOT EXISTS (
    SELECT 1
      FROM pg_class c
      JOIN pg_namespace n ON n.oid = c.relnamespace
      JOIN pg_index i ON i.indexrelid = c.oid
     WHERE n.nspname = 'public'
       AND c.relname = 'student_consents_tenant_id_id_uidx'
       AND i.indrelid = 'public.student_consents'::regclass
       AND i.indisvalid
       AND i.indisunique
       AND i.indnkeyatts = 2
  ) THEN
    RAISE EXCEPTION 'B1: student_consents_tenant_id_id_uidx missing or not valid/unique';
  END IF;
END
$assert_student_consents_tenant_id_id_uidx$;
-- transcript_signing_keys
DO $drop_invalid_transcript_signing_keys_tenant_id_id_uidx$
BEGIN
  IF EXISTS (
    SELECT 1
      FROM pg_class c
      JOIN pg_namespace n ON n.oid = c.relnamespace
      JOIN pg_index i ON i.indexrelid = c.oid
     WHERE n.nspname = 'public'
       AND c.relname = 'transcript_signing_keys_tenant_id_id_uidx'
       AND NOT i.indisvalid
  ) THEN
    RAISE NOTICE 'dropping invalid transcript_signing_keys_tenant_id_id_uidx before rebuild';
    EXECUTE 'DROP INDEX IF EXISTS public.transcript_signing_keys_tenant_id_id_uidx';
  END IF;
END
$drop_invalid_transcript_signing_keys_tenant_id_id_uidx$;
CREATE UNIQUE INDEX CONCURRENTLY IF NOT EXISTS transcript_signing_keys_tenant_id_id_uidx
  ON transcript_signing_keys (tenant_id, id);
DO $assert_transcript_signing_keys_tenant_id_id_uidx$
BEGIN
  IF NOT EXISTS (
    SELECT 1
      FROM pg_class c
      JOIN pg_namespace n ON n.oid = c.relnamespace
      JOIN pg_index i ON i.indexrelid = c.oid
     WHERE n.nspname = 'public'
       AND c.relname = 'transcript_signing_keys_tenant_id_id_uidx'
       AND i.indrelid = 'public.transcript_signing_keys'::regclass
       AND i.indisvalid
       AND i.indisunique
       AND i.indnkeyatts = 2
  ) THEN
    RAISE EXCEPTION 'B1: transcript_signing_keys_tenant_id_id_uidx missing or not valid/unique';
  END IF;
END
$assert_transcript_signing_keys_tenant_id_id_uidx$;
