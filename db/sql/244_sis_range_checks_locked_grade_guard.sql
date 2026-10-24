-- PRC-M198: grade_entries.numeric_score / academic_periods date range have no
-- DB-level CHECK, and a locked grade_entries row can still have its score or
-- letter grade mutated by a direct UPDATE (the app-layer requireUnlocked guard
-- in pg-gradebook-repository.ts's updateGradeEntry is the only thing stopping
-- it today).
--
-- Part A — range checks. The ranges mirror the app-layer TypeBox schema
-- already in force (packages/backend/gradebook/src/schemas.ts:
-- `Type.Number({ minimum: 0, maximum: 100 })` for numericScore) and the
-- already-enforced `end_date >= start_date` invariant implied by
-- academic_periods' own `valid_to >= valid_from` CHECK (db/sql/083) — this
-- adds the matching check on the raw start_date/end_date columns that 083
-- left uncovered.
--
-- Data safety: both added NOT VALID (new writes checked immediately).
-- Existing rows are then validated with FORCE ROW LEVEL SECURITY lifted for
-- the scan and restored in the same transaction (db/sql/114 pattern); grade_entries
-- and academic_periods are both confirmed relforcerowsecurity=true. Live preflight
-- on this worktree's shared Postgres found 0 violating rows for either table, so
-- both validate immediately — if that is ever not true elsewhere, the constraint
-- is left NOT VALID with a RAISE WARNING naming the count instead of failing the
-- deploy.
--
-- Part B — locked-grade mutation guard. A BEFORE UPDATE trigger backstops the
-- app-layer requireUnlocked guard (GradebookService.upsertGradeEntry passes
-- `{ requireUnlocked: true }`, which pg-gradebook-repository.ts's
-- updateGradeEntry enforces under a row lock before writing) for any writer
-- that bypasses the repository (direct SQL, a future code path that forgets
-- the guard). It only blocks numeric_score/letter_grade while locked_at is
-- set — unlocking (setting locked_at back to NULL) and the app's real
-- unlock-then-edit sequence (two separate UPDATEs: unlock first, so the
-- second UPDATE's OLD.locked_at is already NULL) are unaffected, and no other
-- column (metadata, published_at, entered_by, etc.) is touched by this guard.
--
-- Rollback: forward-only; a later migration may DROP the trigger/function or
-- relax/VALIDATE the checks.

ALTER TABLE grade_entries
  DROP CONSTRAINT IF EXISTS grade_entries_numeric_score_range_chk;
ALTER TABLE grade_entries
  ADD CONSTRAINT grade_entries_numeric_score_range_chk
  CHECK (numeric_score IS NULL OR (numeric_score >= 0 AND numeric_score <= 100)) NOT VALID;

ALTER TABLE academic_periods
  DROP CONSTRAINT IF EXISTS academic_periods_date_range_chk;
ALTER TABLE academic_periods
  ADD CONSTRAINT academic_periods_date_range_chk
  CHECK (end_date >= start_date) NOT VALID;

DO $prc_m198_validate$
DECLARE
  was_forced boolean;
  bad_rows bigint;
BEGIN
  -- grade_entries numeric_score range.
  SELECT relforcerowsecurity INTO was_forced
    FROM pg_class WHERE oid = 'public.grade_entries'::regclass;
  IF was_forced THEN
    ALTER TABLE grade_entries NO FORCE ROW LEVEL SECURITY;
  END IF;

  SELECT count(*) INTO bad_rows
    FROM grade_entries
   WHERE numeric_score IS NOT NULL
     AND (numeric_score < 0 OR numeric_score > 100);

  IF bad_rows = 0 THEN
    ALTER TABLE grade_entries VALIDATE CONSTRAINT grade_entries_numeric_score_range_chk;
  ELSE
    RAISE WARNING
      'PRC-M198: % grade_entries row(s) have numeric_score outside 0..100; '
      'grade_entries_numeric_score_range_chk left NOT VALID (new writes are '
      'still checked). Correct those rows, then VALIDATE CONSTRAINT '
      'grade_entries_numeric_score_range_chk.',
      bad_rows;
  END IF;

  IF was_forced THEN
    ALTER TABLE grade_entries FORCE ROW LEVEL SECURITY;
  END IF;

  -- academic_periods date range.
  SELECT relforcerowsecurity INTO was_forced
    FROM pg_class WHERE oid = 'public.academic_periods'::regclass;
  IF was_forced THEN
    ALTER TABLE academic_periods NO FORCE ROW LEVEL SECURITY;
  END IF;

  SELECT count(*) INTO bad_rows
    FROM academic_periods
   WHERE end_date < start_date;

  IF bad_rows = 0 THEN
    ALTER TABLE academic_periods VALIDATE CONSTRAINT academic_periods_date_range_chk;
  ELSE
    RAISE WARNING
      'PRC-M198: % academic_periods row(s) have end_date < start_date; '
      'academic_periods_date_range_chk left NOT VALID (new writes are still '
      'checked). Correct those rows, then VALIDATE CONSTRAINT '
      'academic_periods_date_range_chk.',
      bad_rows;
  END IF;

  IF was_forced THEN
    ALTER TABLE academic_periods FORCE ROW LEVEL SECURITY;
  END IF;
END
$prc_m198_validate$;

-- Part B: locked-grade mutation guard (backstop under the app-layer requireUnlocked guard).
CREATE OR REPLACE FUNCTION grade_entries_locked_immutable()
RETURNS TRIGGER AS $$
BEGIN
  IF OLD.locked_at IS NOT NULL
     AND (NEW.numeric_score IS DISTINCT FROM OLD.numeric_score
          OR NEW.letter_grade IS DISTINCT FROM OLD.letter_grade) THEN
    RAISE EXCEPTION
      'grade_entries numeric_score/letter_grade cannot be mutated while locked_at is set; unlock first'
      USING ERRCODE = 'integrity_constraint_violation';
  END IF;
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

DROP TRIGGER IF EXISTS trg_grade_entries_locked_immutable ON grade_entries;
CREATE TRIGGER trg_grade_entries_locked_immutable
  BEFORE UPDATE ON grade_entries
  FOR EACH ROW
  EXECUTE FUNCTION grade_entries_locked_immutable();

INSERT INTO schema_migrations (filename)
VALUES ('244_sis_range_checks_locked_grade_guard.sql')
ON CONFLICT (filename) DO NOTHING;
