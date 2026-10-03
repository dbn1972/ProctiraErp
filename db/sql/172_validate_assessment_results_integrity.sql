-- PRC-M161: validate the result -> item composite FK (171) and the 087 NOT VALID
-- student FK.
--
-- NEEDS DB REVIEW.
--
-- Each constraint is validated only when no existing row violates it; FORCE ROW LEVEL
-- SECURITY is lifted for the scan (otherwise the owner scan sees zero rows and VALIDATE
-- proves nothing) and restored in the same transaction. Violations leave the constraint
-- NOT VALID with a WARNING naming the count (new writes are still checked); no row is
-- rewritten. Idempotent.
-- Rollback: forward-only.
DO $m161_validate$
DECLARE
  was_forced boolean;
  bad_items bigint;
  bad_students bigint;
BEGIN
  SELECT relforcerowsecurity INTO was_forced
    FROM pg_class WHERE oid = 'public.assessment_results'::regclass;
  IF was_forced THEN
    ALTER TABLE assessment_results NO FORCE ROW LEVEL SECURITY;
  END IF;

  IF EXISTS (
    SELECT 1 FROM pg_constraint
     WHERE conname = 'assessment_results_item_subject_period_fk' AND NOT convalidated
  ) THEN
    SELECT count(*) INTO bad_items
      FROM assessment_results r
     WHERE NOT EXISTS (
       SELECT 1 FROM assessment_items i
        WHERE i.tenant_id = r.tenant_id AND i.id = r.assessment_item_id
          AND i.subject_id = r.subject_id AND i.academic_period_id = r.academic_period_id
     );
    IF bad_items = 0 THEN
      ALTER TABLE assessment_results VALIDATE CONSTRAINT assessment_results_item_subject_period_fk;
    ELSE
      RAISE WARNING
        'PRC-M161: % assessment_results row(s) disagree with their item subject/period; '
        'assessment_results_item_subject_period_fk left NOT VALID.', bad_items;
    END IF;
  END IF;

  IF EXISTS (
    SELECT 1 FROM pg_constraint
     WHERE conname = 'assessment_results_student_id_fkey' AND NOT convalidated
  ) THEN
    SELECT count(*) INTO bad_students
      FROM assessment_results r
     WHERE NOT EXISTS (SELECT 1 FROM students s WHERE s.id = r.student_id);
    IF bad_students = 0 THEN
      ALTER TABLE assessment_results VALIDATE CONSTRAINT assessment_results_student_id_fkey;
    ELSE
      RAISE WARNING
        'PRC-M161: % assessment_results row(s) reference a missing student; '
        'assessment_results_student_id_fkey left NOT VALID.', bad_students;
    END IF;
  END IF;

  IF was_forced THEN
    ALTER TABLE assessment_results FORCE ROW LEVEL SECURITY;
  END IF;
END
$m161_validate$;
