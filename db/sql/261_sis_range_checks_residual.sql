-- PRC-M198 residual: db/sql/244 added DB-level range CHECKs for
-- grade_entries.numeric_score and academic_periods start/end. A catalog
-- inventory of the other core SIS tables (students, enrollments, classes,
-- grades, subjects, assessment_results, student_attendance) found two more
-- columns whose range is already enforced by an app TypeBox schema but not by
-- the database:
--   classes.capacity  Type.Integer({ minimum: 1, maximum: 32767 })
--                     (packages/backend/institution/src/education/class-schemas.ts:14,22;
--                      nullable; 32767 is already the smallint ceiling)
--   grades."order"    Type.Integer({ minimum: 0, maximum: 32767 })
--                     (packages/backend/institution/src/education/grade-schemas.ts:9,16)
-- Not mirrored (no fixed app-layer range, so a CHECK would invent a business
-- rule): assessment_results.score (bounded by the per-scheme range),
-- enrollments exited_at vs enrolled_at (no schema-level rule), students
-- date_of_birth (format only).
--
-- Same pattern as 244: ADD ... NOT VALID (new writes checked immediately),
-- then VALIDATE with FORCE ROW LEVEL SECURITY lifted and restored in the same
-- transaction. If existing rows violate a range the constraint is left NOT
-- VALID with a WARNING naming the count (data is never rewritten or deleted).
--
-- Locks (PR rollout note): ADD CONSTRAINT NOT VALID is catalog-only; lifting
-- FORCE takes ACCESS EXCLUSIVE on classes / grades until COMMIT; VALIDATE scans
-- each table (small reference tables).
--
-- Idempotent: constraints are added only when absent; VALIDATE on a valid
-- constraint is a no-op.
--
-- Rollback (forward-only repo; body of a future revert migration):
--   ALTER TABLE classes DROP CONSTRAINT IF EXISTS classes_capacity_range_chk;
--   ALTER TABLE grades DROP CONSTRAINT IF EXISTS grades_order_range_chk;
-- Data loss on rollback: none (constraints only).

DO $prc_m198_residual_add$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint
     WHERE conrelid = 'public.classes'::regclass AND conname = 'classes_capacity_range_chk'
  ) THEN
    ALTER TABLE public.classes
      ADD CONSTRAINT classes_capacity_range_chk
      CHECK (capacity IS NULL OR capacity >= 1) NOT VALID;
  END IF;
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint
     WHERE conrelid = 'public.grades'::regclass AND conname = 'grades_order_range_chk'
  ) THEN
    ALTER TABLE public.grades
      ADD CONSTRAINT grades_order_range_chk
      CHECK ("order" >= 0) NOT VALID;
  END IF;
END
$prc_m198_residual_add$;

DO $prc_m198_residual_validate$
DECLARE
  was_forced boolean;
  bad_rows bigint;
BEGIN
  -- classes.capacity >= 1
  SELECT relforcerowsecurity INTO was_forced FROM pg_class WHERE oid = 'public.classes'::regclass;
  IF was_forced THEN
    ALTER TABLE public.classes NO FORCE ROW LEVEL SECURITY;
  END IF;
  SELECT count(*) INTO bad_rows FROM public.classes WHERE capacity IS NOT NULL AND capacity < 1;
  IF bad_rows = 0 THEN
    ALTER TABLE public.classes VALIDATE CONSTRAINT classes_capacity_range_chk;
  ELSE
    RAISE WARNING
      'PRC-M198: % classes row(s) have capacity < 1; classes_capacity_range_chk left '
      'NOT VALID (new writes are still checked). Correct those rows, then VALIDATE '
      'CONSTRAINT classes_capacity_range_chk.',
      bad_rows;
  END IF;
  IF was_forced THEN
    ALTER TABLE public.classes FORCE ROW LEVEL SECURITY;
  END IF;

  -- grades."order" >= 0
  SELECT relforcerowsecurity INTO was_forced FROM pg_class WHERE oid = 'public.grades'::regclass;
  IF was_forced THEN
    ALTER TABLE public.grades NO FORCE ROW LEVEL SECURITY;
  END IF;
  SELECT count(*) INTO bad_rows FROM public.grades WHERE "order" < 0;
  IF bad_rows = 0 THEN
    ALTER TABLE public.grades VALIDATE CONSTRAINT grades_order_range_chk;
  ELSE
    RAISE WARNING
      'PRC-M198: % grades row(s) have "order" < 0; grades_order_range_chk left NOT '
      'VALID (new writes are still checked). Correct those rows, then VALIDATE '
      'CONSTRAINT grades_order_range_chk.',
      bad_rows;
  END IF;
  IF was_forced THEN
    ALTER TABLE public.grades FORCE ROW LEVEL SECURITY;
  END IF;
END
$prc_m198_residual_validate$;
