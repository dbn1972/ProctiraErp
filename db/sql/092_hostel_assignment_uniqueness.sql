-- UP-P0-02: move hostel assignment integrity DDL out of application runtime.
--
-- Replacement is fail-safe for a valid-but-drifted canonical index:
--   1. build and validate a temporary canonical replacement while the old
--      index remains online;
--   2. atomically rename old -> retired and replacement -> canonical;
--   3. assert the canonical contract before dropping retired artifacts.
--
-- Concurrent build/drop statements are resumable apply-sql phases. A failed
-- replacement build is never allowed to remove the existing uniqueness guard.

-- Remove only an unusable temporary replacement. The canonical index is not
-- touched in this phase.
WITH desired(index_name, key_column, replacement_name) AS (
  VALUES
    (
      'uq_hostel_assignments_active_bed',
      'bed_id',
      'uq_hostel_assignments_active_bed__replacement'
    ),
    (
      'uq_hostel_assignments_active_student',
      'student_id',
      'uq_hostel_assignments_active_student__replacement'
    )
), replacement_state AS (
  SELECT desired.*,
         replacement_class.oid AS replacement_oid,
         public.proctira_hostel_assignment_index_ready(
           desired.replacement_name,
           desired.key_column
         ) AS replacement_matches_contract
    FROM desired
    LEFT JOIN pg_namespace AS replacement_namespace
      ON replacement_namespace.nspname = 'public'
    LEFT JOIN pg_class AS replacement_class
      ON replacement_class.relnamespace = replacement_namespace.oid
     AND replacement_class.relname = desired.replacement_name
     AND replacement_class.relkind = 'i'
)
SELECT format(
         'DROP INDEX CONCURRENTLY IF EXISTS public.%I',
         replacement_name
       )
  FROM replacement_state
 WHERE replacement_oid IS NOT NULL
   AND NOT replacement_matches_contract
 ORDER BY replacement_name
\gexec

-- Build the replacement before changing or dropping the existing canonical
-- index. Duplicate data or a timeout fails here with the old invariant intact.
WITH desired(index_name, key_column, replacement_name) AS (
  VALUES
    (
      'uq_hostel_assignments_active_bed',
      'bed_id',
      'uq_hostel_assignments_active_bed__replacement'
    ),
    (
      'uq_hostel_assignments_active_student',
      'student_id',
      'uq_hostel_assignments_active_student__replacement'
    )
)
SELECT format(
         'CREATE UNIQUE INDEX CONCURRENTLY %I ON public.hostel_assignments (tenant_id, %I) WHERE is_active',
         replacement_name,
         key_column
       )
  FROM desired
 WHERE NOT public.proctira_hostel_assignment_index_ready(index_name, key_column)
   AND NOT public.proctira_hostel_assignment_index_ready(replacement_name, key_column)
 ORDER BY index_name
\gexec

-- Each old/new rename pair runs in one transaction. If the replacement rename
-- fails, PostgreSQL rolls back the old-index rename as well.
DO $swap_indexes$
DECLARE
  target RECORD;
BEGIN
  FOR target IN
    SELECT *
      FROM (VALUES
        (
          'uq_hostel_assignments_active_bed',
          'bed_id',
          'uq_hostel_assignments_active_bed__replacement',
          'uq_hostel_assignments_active_bed__retired'
        ),
        (
          'uq_hostel_assignments_active_student',
          'student_id',
          'uq_hostel_assignments_active_student__replacement',
          'uq_hostel_assignments_active_student__retired'
        )
      ) AS targets(index_name, key_column, replacement_name, retired_name)
  LOOP
    IF public.proctira_hostel_assignment_index_ready(
      target.index_name,
      target.key_column
    ) THEN
      CONTINUE;
    END IF;

    IF NOT public.proctira_hostel_assignment_index_ready(
      target.replacement_name,
      target.key_column
    ) THEN
      RAISE EXCEPTION
        'UP-P0-02 replacement index is not ready: %',
        target.replacement_name;
    END IF;

    IF to_regclass(format('%I.%I', 'public', target.retired_name)) IS NOT NULL THEN
      RAISE EXCEPTION
        'UP-P0-02 retired index name already exists; inspect before retry: %',
        target.retired_name;
    END IF;

    IF to_regclass(format('%I.%I', 'public', target.index_name)) IS NOT NULL THEN
      EXECUTE format(
        'ALTER INDEX public.%I RENAME TO %I',
        target.index_name,
        target.retired_name
      );
    END IF;

    EXECUTE format(
      'ALTER INDEX public.%I RENAME TO %I',
      target.replacement_name,
      target.index_name
    );
  END LOOP;
END
$swap_indexes$;

DO $assert_indexes$
DECLARE
  invalid_indexes TEXT;
BEGIN
  WITH desired(index_name, key_column) AS (
    VALUES
      ('uq_hostel_assignments_active_bed', 'bed_id'),
      ('uq_hostel_assignments_active_student', 'student_id')
  )
  SELECT string_agg(desired.index_name, ', ' ORDER BY desired.index_name)
    INTO invalid_indexes
    FROM desired
   WHERE NOT public.proctira_hostel_assignment_index_ready(
     desired.index_name,
     desired.key_column
   );

  IF invalid_indexes IS NOT NULL THEN
    RAISE EXCEPTION
      'UP-P0-02 hostel uniqueness index contract invalid or incomplete: %',
      invalid_indexes;
  END IF;
END
$assert_indexes$;

-- Cleanup happens only after the canonical contract is proven. Replacement
-- names normally disappear during rename; IF EXISTS keeps retries idempotent.
WITH desired(index_name, key_column, replacement_name, retired_name) AS (
  VALUES
    (
      'uq_hostel_assignments_active_bed',
      'bed_id',
      'uq_hostel_assignments_active_bed__replacement',
      'uq_hostel_assignments_active_bed__retired'
    ),
    (
      'uq_hostel_assignments_active_student',
      'student_id',
      'uq_hostel_assignments_active_student__replacement',
      'uq_hostel_assignments_active_student__retired'
    )
)
SELECT format('DROP INDEX CONCURRENTLY IF EXISTS public.%I', cleanup_name)
  FROM desired
 CROSS JOIN LATERAL (
   VALUES (replacement_name), (retired_name)
 ) AS cleanup(cleanup_name)
 WHERE public.proctira_hostel_assignment_index_ready(index_name, key_column)
 ORDER BY index_name, cleanup_name
\gexec
