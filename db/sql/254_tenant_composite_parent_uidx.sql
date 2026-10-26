-- PRC-M195 / PRC-M208 / PRC-L095 / PRC-M548 / PRC-L289 (shared): parent-side
-- UNIQUE (tenant_id, id) indexes so child tables can carry composite
-- (tenant_id, <fk>) -> parent (tenant_id, id) foreign keys (added NOT VALID in
-- db/sql/255, validated with FORCE RLS lifted in db/sql/256).
--
-- Today every cross-entity FK on these parents is id-only (for example
-- db/sql/035_students_360_schema.sql:11 `student_id ... REFERENCES students(id)`),
-- so a tenant-A child row can reference a tenant-B parent id: the RI check runs
-- as the table owner and ignores RLS. A composite FK needs a unique index whose
-- columns are exactly (tenant_id, id) on the parent; `id` is already the PK, so
-- no duplicate preflight is needed (the pair is unique by construction).
--
-- W1-DATA-17: CREATE UNIQUE INDEX CONCURRENTLY cannot run inside a transaction,
-- so apply-sql.sh applies this file statement-by-statement through the
-- schema_migration_phases ledger. Every statement is idempotent
-- compensating-forward DDL: (1) drop an INVALID leftover from an interrupted
-- build, (2) build, (3) assert present + valid + unique. Lock: SHARE UPDATE
-- EXCLUSIVE per parent for the build only (reads and writes continue).
--
-- Rollback (forward-only repo; body of a future revert migration, after the
-- db/sql/255 composite FKs that depend on these indexes are dropped):
--   DROP INDEX IF EXISTS <parent>_tenant_id_id_uidx;  -- for each parent below
-- Data loss on rollback: none (index only).

-- students
DO $drop_invalid_students_tenant_id_id_uidx$
BEGIN
  IF EXISTS (
    SELECT 1
      FROM pg_class c
      JOIN pg_namespace n ON n.oid = c.relnamespace
      JOIN pg_index i ON i.indexrelid = c.oid
     WHERE n.nspname = 'public'
       AND c.relname = 'students_tenant_id_id_uidx'
       AND NOT i.indisvalid
  ) THEN
    RAISE NOTICE 'dropping invalid students_tenant_id_id_uidx before rebuild';
    EXECUTE 'DROP INDEX IF EXISTS public.students_tenant_id_id_uidx';
  END IF;
END
$drop_invalid_students_tenant_id_id_uidx$;

CREATE UNIQUE INDEX CONCURRENTLY IF NOT EXISTS students_tenant_id_id_uidx
  ON students (tenant_id, id);

DO $assert_students_tenant_id_id_uidx$
BEGIN
  IF NOT EXISTS (
    SELECT 1
      FROM pg_class c
      JOIN pg_namespace n ON n.oid = c.relnamespace
      JOIN pg_index i ON i.indexrelid = c.oid
     WHERE n.nspname = 'public'
       AND c.relname = 'students_tenant_id_id_uidx'
       AND i.indrelid = 'public.students'::regclass
       AND i.indisvalid
       AND i.indisunique
       AND i.indnkeyatts = 2
  ) THEN
    RAISE EXCEPTION 'PRC-M195: students_tenant_id_id_uidx missing or not valid/unique';
  END IF;
END
$assert_students_tenant_id_id_uidx$;

-- staff
DO $drop_invalid_staff_tenant_id_id_uidx$
BEGIN
  IF EXISTS (
    SELECT 1
      FROM pg_class c
      JOIN pg_namespace n ON n.oid = c.relnamespace
      JOIN pg_index i ON i.indexrelid = c.oid
     WHERE n.nspname = 'public'
       AND c.relname = 'staff_tenant_id_id_uidx'
       AND NOT i.indisvalid
  ) THEN
    RAISE NOTICE 'dropping invalid staff_tenant_id_id_uidx before rebuild';
    EXECUTE 'DROP INDEX IF EXISTS public.staff_tenant_id_id_uidx';
  END IF;
END
$drop_invalid_staff_tenant_id_id_uidx$;

CREATE UNIQUE INDEX CONCURRENTLY IF NOT EXISTS staff_tenant_id_id_uidx
  ON staff (tenant_id, id);

DO $assert_staff_tenant_id_id_uidx$
BEGIN
  IF NOT EXISTS (
    SELECT 1
      FROM pg_class c
      JOIN pg_namespace n ON n.oid = c.relnamespace
      JOIN pg_index i ON i.indexrelid = c.oid
     WHERE n.nspname = 'public'
       AND c.relname = 'staff_tenant_id_id_uidx'
       AND i.indrelid = 'public.staff'::regclass
       AND i.indisvalid
       AND i.indisunique
       AND i.indnkeyatts = 2
  ) THEN
    RAISE EXCEPTION 'PRC-M195: staff_tenant_id_id_uidx missing or not valid/unique';
  END IF;
END
$assert_staff_tenant_id_id_uidx$;

-- institutions
DO $drop_invalid_institutions_tenant_id_id_uidx$
BEGIN
  IF EXISTS (
    SELECT 1
      FROM pg_class c
      JOIN pg_namespace n ON n.oid = c.relnamespace
      JOIN pg_index i ON i.indexrelid = c.oid
     WHERE n.nspname = 'public'
       AND c.relname = 'institutions_tenant_id_id_uidx'
       AND NOT i.indisvalid
  ) THEN
    RAISE NOTICE 'dropping invalid institutions_tenant_id_id_uidx before rebuild';
    EXECUTE 'DROP INDEX IF EXISTS public.institutions_tenant_id_id_uidx';
  END IF;
END
$drop_invalid_institutions_tenant_id_id_uidx$;

CREATE UNIQUE INDEX CONCURRENTLY IF NOT EXISTS institutions_tenant_id_id_uidx
  ON institutions (tenant_id, id);

DO $assert_institutions_tenant_id_id_uidx$
BEGIN
  IF NOT EXISTS (
    SELECT 1
      FROM pg_class c
      JOIN pg_namespace n ON n.oid = c.relnamespace
      JOIN pg_index i ON i.indexrelid = c.oid
     WHERE n.nspname = 'public'
       AND c.relname = 'institutions_tenant_id_id_uidx'
       AND i.indrelid = 'public.institutions'::regclass
       AND i.indisvalid
       AND i.indisunique
       AND i.indnkeyatts = 2
  ) THEN
    RAISE EXCEPTION 'PRC-M195: institutions_tenant_id_id_uidx missing or not valid/unique';
  END IF;
END
$assert_institutions_tenant_id_id_uidx$;

-- fee_structures
DO $drop_invalid_fee_structures_tenant_id_id_uidx$
BEGIN
  IF EXISTS (
    SELECT 1
      FROM pg_class c
      JOIN pg_namespace n ON n.oid = c.relnamespace
      JOIN pg_index i ON i.indexrelid = c.oid
     WHERE n.nspname = 'public'
       AND c.relname = 'fee_structures_tenant_id_id_uidx'
       AND NOT i.indisvalid
  ) THEN
    RAISE NOTICE 'dropping invalid fee_structures_tenant_id_id_uidx before rebuild';
    EXECUTE 'DROP INDEX IF EXISTS public.fee_structures_tenant_id_id_uidx';
  END IF;
END
$drop_invalid_fee_structures_tenant_id_id_uidx$;

CREATE UNIQUE INDEX CONCURRENTLY IF NOT EXISTS fee_structures_tenant_id_id_uidx
  ON fee_structures (tenant_id, id);

DO $assert_fee_structures_tenant_id_id_uidx$
BEGIN
  IF NOT EXISTS (
    SELECT 1
      FROM pg_class c
      JOIN pg_namespace n ON n.oid = c.relnamespace
      JOIN pg_index i ON i.indexrelid = c.oid
     WHERE n.nspname = 'public'
       AND c.relname = 'fee_structures_tenant_id_id_uidx'
       AND i.indrelid = 'public.fee_structures'::regclass
       AND i.indisvalid
       AND i.indisunique
       AND i.indnkeyatts = 2
  ) THEN
    RAISE EXCEPTION 'PRC-M195: fee_structures_tenant_id_id_uidx missing or not valid/unique';
  END IF;
END
$assert_fee_structures_tenant_id_id_uidx$;

-- parent_fee_invoices
DO $drop_invalid_parent_fee_invoices_tenant_id_id_uidx$
BEGIN
  IF EXISTS (
    SELECT 1
      FROM pg_class c
      JOIN pg_namespace n ON n.oid = c.relnamespace
      JOIN pg_index i ON i.indexrelid = c.oid
     WHERE n.nspname = 'public'
       AND c.relname = 'parent_fee_invoices_tenant_id_id_uidx'
       AND NOT i.indisvalid
  ) THEN
    RAISE NOTICE 'dropping invalid parent_fee_invoices_tenant_id_id_uidx before rebuild';
    EXECUTE 'DROP INDEX IF EXISTS public.parent_fee_invoices_tenant_id_id_uidx';
  END IF;
END
$drop_invalid_parent_fee_invoices_tenant_id_id_uidx$;

CREATE UNIQUE INDEX CONCURRENTLY IF NOT EXISTS parent_fee_invoices_tenant_id_id_uidx
  ON parent_fee_invoices (tenant_id, id);

DO $assert_parent_fee_invoices_tenant_id_id_uidx$
BEGIN
  IF NOT EXISTS (
    SELECT 1
      FROM pg_class c
      JOIN pg_namespace n ON n.oid = c.relnamespace
      JOIN pg_index i ON i.indexrelid = c.oid
     WHERE n.nspname = 'public'
       AND c.relname = 'parent_fee_invoices_tenant_id_id_uidx'
       AND i.indrelid = 'public.parent_fee_invoices'::regclass
       AND i.indisvalid
       AND i.indisunique
       AND i.indnkeyatts = 2
  ) THEN
    RAISE EXCEPTION 'PRC-M195: parent_fee_invoices_tenant_id_id_uidx missing or not valid/unique';
  END IF;
END
$assert_parent_fee_invoices_tenant_id_id_uidx$;

-- classes
DO $drop_invalid_classes_tenant_id_id_uidx$
BEGIN
  IF EXISTS (
    SELECT 1
      FROM pg_class c
      JOIN pg_namespace n ON n.oid = c.relnamespace
      JOIN pg_index i ON i.indexrelid = c.oid
     WHERE n.nspname = 'public'
       AND c.relname = 'classes_tenant_id_id_uidx'
       AND NOT i.indisvalid
  ) THEN
    RAISE NOTICE 'dropping invalid classes_tenant_id_id_uidx before rebuild';
    EXECUTE 'DROP INDEX IF EXISTS public.classes_tenant_id_id_uidx';
  END IF;
END
$drop_invalid_classes_tenant_id_id_uidx$;

CREATE UNIQUE INDEX CONCURRENTLY IF NOT EXISTS classes_tenant_id_id_uidx
  ON classes (tenant_id, id);

DO $assert_classes_tenant_id_id_uidx$
BEGIN
  IF NOT EXISTS (
    SELECT 1
      FROM pg_class c
      JOIN pg_namespace n ON n.oid = c.relnamespace
      JOIN pg_index i ON i.indexrelid = c.oid
     WHERE n.nspname = 'public'
       AND c.relname = 'classes_tenant_id_id_uidx'
       AND i.indrelid = 'public.classes'::regclass
       AND i.indisvalid
       AND i.indisunique
       AND i.indnkeyatts = 2
  ) THEN
    RAISE EXCEPTION 'PRC-M195: classes_tenant_id_id_uidx missing or not valid/unique';
  END IF;
END
$assert_classes_tenant_id_id_uidx$;

-- grades
DO $drop_invalid_grades_tenant_id_id_uidx$
BEGIN
  IF EXISTS (
    SELECT 1
      FROM pg_class c
      JOIN pg_namespace n ON n.oid = c.relnamespace
      JOIN pg_index i ON i.indexrelid = c.oid
     WHERE n.nspname = 'public'
       AND c.relname = 'grades_tenant_id_id_uidx'
       AND NOT i.indisvalid
  ) THEN
    RAISE NOTICE 'dropping invalid grades_tenant_id_id_uidx before rebuild';
    EXECUTE 'DROP INDEX IF EXISTS public.grades_tenant_id_id_uidx';
  END IF;
END
$drop_invalid_grades_tenant_id_id_uidx$;

CREATE UNIQUE INDEX CONCURRENTLY IF NOT EXISTS grades_tenant_id_id_uidx
  ON grades (tenant_id, id);

DO $assert_grades_tenant_id_id_uidx$
BEGIN
  IF NOT EXISTS (
    SELECT 1
      FROM pg_class c
      JOIN pg_namespace n ON n.oid = c.relnamespace
      JOIN pg_index i ON i.indexrelid = c.oid
     WHERE n.nspname = 'public'
       AND c.relname = 'grades_tenant_id_id_uidx'
       AND i.indrelid = 'public.grades'::regclass
       AND i.indisvalid
       AND i.indisunique
       AND i.indnkeyatts = 2
  ) THEN
    RAISE EXCEPTION 'PRC-M195: grades_tenant_id_id_uidx missing or not valid/unique';
  END IF;
END
$assert_grades_tenant_id_id_uidx$;

-- academic_periods
DO $drop_invalid_academic_periods_tenant_id_id_uidx$
BEGIN
  IF EXISTS (
    SELECT 1
      FROM pg_class c
      JOIN pg_namespace n ON n.oid = c.relnamespace
      JOIN pg_index i ON i.indexrelid = c.oid
     WHERE n.nspname = 'public'
       AND c.relname = 'academic_periods_tenant_id_id_uidx'
       AND NOT i.indisvalid
  ) THEN
    RAISE NOTICE 'dropping invalid academic_periods_tenant_id_id_uidx before rebuild';
    EXECUTE 'DROP INDEX IF EXISTS public.academic_periods_tenant_id_id_uidx';
  END IF;
END
$drop_invalid_academic_periods_tenant_id_id_uidx$;

CREATE UNIQUE INDEX CONCURRENTLY IF NOT EXISTS academic_periods_tenant_id_id_uidx
  ON academic_periods (tenant_id, id);

DO $assert_academic_periods_tenant_id_id_uidx$
BEGIN
  IF NOT EXISTS (
    SELECT 1
      FROM pg_class c
      JOIN pg_namespace n ON n.oid = c.relnamespace
      JOIN pg_index i ON i.indexrelid = c.oid
     WHERE n.nspname = 'public'
       AND c.relname = 'academic_periods_tenant_id_id_uidx'
       AND i.indrelid = 'public.academic_periods'::regclass
       AND i.indisvalid
       AND i.indisunique
       AND i.indnkeyatts = 2
  ) THEN
    RAISE EXCEPTION 'PRC-M195: academic_periods_tenant_id_id_uidx missing or not valid/unique';
  END IF;
END
$assert_academic_periods_tenant_id_id_uidx$;

-- subjects
DO $drop_invalid_subjects_tenant_id_id_uidx$
BEGIN
  IF EXISTS (
    SELECT 1
      FROM pg_class c
      JOIN pg_namespace n ON n.oid = c.relnamespace
      JOIN pg_index i ON i.indexrelid = c.oid
     WHERE n.nspname = 'public'
       AND c.relname = 'subjects_tenant_id_id_uidx'
       AND NOT i.indisvalid
  ) THEN
    RAISE NOTICE 'dropping invalid subjects_tenant_id_id_uidx before rebuild';
    EXECUTE 'DROP INDEX IF EXISTS public.subjects_tenant_id_id_uidx';
  END IF;
END
$drop_invalid_subjects_tenant_id_id_uidx$;

CREATE UNIQUE INDEX CONCURRENTLY IF NOT EXISTS subjects_tenant_id_id_uidx
  ON subjects (tenant_id, id);

DO $assert_subjects_tenant_id_id_uidx$
BEGIN
  IF NOT EXISTS (
    SELECT 1
      FROM pg_class c
      JOIN pg_namespace n ON n.oid = c.relnamespace
      JOIN pg_index i ON i.indexrelid = c.oid
     WHERE n.nspname = 'public'
       AND c.relname = 'subjects_tenant_id_id_uidx'
       AND i.indrelid = 'public.subjects'::regclass
       AND i.indisvalid
       AND i.indisunique
       AND i.indnkeyatts = 2
  ) THEN
    RAISE EXCEPTION 'PRC-M195: subjects_tenant_id_id_uidx missing or not valid/unique';
  END IF;
END
$assert_subjects_tenant_id_id_uidx$;

-- syllabus_units
DO $drop_invalid_syllabus_units_tenant_id_id_uidx$
BEGIN
  IF EXISTS (
    SELECT 1
      FROM pg_class c
      JOIN pg_namespace n ON n.oid = c.relnamespace
      JOIN pg_index i ON i.indexrelid = c.oid
     WHERE n.nspname = 'public'
       AND c.relname = 'syllabus_units_tenant_id_id_uidx'
       AND NOT i.indisvalid
  ) THEN
    RAISE NOTICE 'dropping invalid syllabus_units_tenant_id_id_uidx before rebuild';
    EXECUTE 'DROP INDEX IF EXISTS public.syllabus_units_tenant_id_id_uidx';
  END IF;
END
$drop_invalid_syllabus_units_tenant_id_id_uidx$;

CREATE UNIQUE INDEX CONCURRENTLY IF NOT EXISTS syllabus_units_tenant_id_id_uidx
  ON syllabus_units (tenant_id, id);

DO $assert_syllabus_units_tenant_id_id_uidx$
BEGIN
  IF NOT EXISTS (
    SELECT 1
      FROM pg_class c
      JOIN pg_namespace n ON n.oid = c.relnamespace
      JOIN pg_index i ON i.indexrelid = c.oid
     WHERE n.nspname = 'public'
       AND c.relname = 'syllabus_units_tenant_id_id_uidx'
       AND i.indrelid = 'public.syllabus_units'::regclass
       AND i.indisvalid
       AND i.indisunique
       AND i.indnkeyatts = 2
  ) THEN
    RAISE EXCEPTION 'PRC-M195: syllabus_units_tenant_id_id_uidx missing or not valid/unique';
  END IF;
END
$assert_syllabus_units_tenant_id_id_uidx$;
