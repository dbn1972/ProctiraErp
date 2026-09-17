-- UP-P0-02: move hostel assignment integrity DDL out of application runtime.
--
-- This entire file is deliberately one apply-sql phase. psql \gexec runs any
-- missing/drifted-index cleanup and replacement before the catalog assertion.
-- If a concurrent build fails or the process crashes, the phase is not ledgered;
-- retry re-evaluates catalog state and rebuilds the canonical contract. Matching
-- valid indexes created by the former runtime guard remain online.

WITH desired(index_name, key_column) AS (
  VALUES
    ('uq_hostel_assignments_active_bed', 'bed_id'),
    ('uq_hostel_assignments_active_student', 'student_id')
), state AS (
  SELECT desired.*,
         index_class.oid AS index_oid,
         public.proctira_hostel_assignment_index_ready(
           desired.index_name,
           desired.key_column
         ) AS index_matches_contract
    FROM desired
    LEFT JOIN pg_namespace AS index_namespace
      ON index_namespace.nspname = 'public'
    LEFT JOIN pg_class AS index_class
      ON index_class.relnamespace = index_namespace.oid
     AND index_class.relname = desired.index_name
     AND index_class.relkind = 'i'
)
SELECT command
  FROM (
    SELECT index_name,
           1 AS action_order,
           format('DROP INDEX CONCURRENTLY IF EXISTS public.%I', index_name) AS command
      FROM state
     WHERE index_oid IS NOT NULL AND NOT index_matches_contract
    UNION ALL
    SELECT index_name,
           2 AS action_order,
           format(
             'CREATE UNIQUE INDEX CONCURRENTLY %I ON public.hostel_assignments (tenant_id, %I) WHERE is_active',
             index_name,
             key_column
           ) AS command
      FROM state
     WHERE index_oid IS NULL OR NOT index_matches_contract
  ) AS commands
 ORDER BY index_name, action_order
\gexec

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
