-- UP-P0-02: narrowly expose migration readiness to the non-owner runtime role.
-- The underlying ledgers remain denied; callers can only ask whether named,
-- checksum-recorded migrations (and their live integrity contract) are ready.

CREATE OR REPLACE FUNCTION public.proctira_hostel_assignment_index_ready(
  required_index_name TEXT,
  required_key_column TEXT
)
RETURNS BOOLEAN
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = pg_catalog, public
AS $function$
  SELECT EXISTS (
    SELECT 1
      FROM pg_namespace AS index_namespace
      JOIN pg_class AS index_class
        ON index_class.relnamespace = index_namespace.oid
       AND index_class.relname = required_index_name
       AND index_class.relkind = 'i'
      JOIN pg_index AS index_state
        ON index_state.indexrelid = index_class.oid
      JOIN pg_class AS table_class
        ON table_class.oid = index_state.indrelid
      JOIN pg_namespace AS table_namespace
        ON table_namespace.oid = table_class.relnamespace
     WHERE index_namespace.nspname = 'public'
       AND table_namespace.nspname = 'public'
       AND table_class.relname = 'hostel_assignments'
       AND index_state.indisvalid
       AND index_state.indisunique
       AND pg_get_expr(index_state.indpred, index_state.indrelid) = 'is_active'
       AND (
         SELECT array_agg(attribute.attname::TEXT ORDER BY key_part.ordinality)
           FROM unnest(index_state.indkey) WITH ORDINALITY
             AS key_part(attribute_number, ordinality)
           JOIN pg_attribute AS attribute
             ON attribute.attrelid = index_state.indrelid
            AND attribute.attnum = key_part.attribute_number
          WHERE key_part.ordinality <= index_state.indnkeyatts
       ) = ARRAY['tenant_id', required_key_column]
  )
$function$;

REVOKE ALL ON FUNCTION public.proctira_hostel_assignment_index_ready(TEXT, TEXT) FROM PUBLIC;

CREATE OR REPLACE FUNCTION public.proctira_runtime_migration_status(required_filenames TEXT[])
RETURNS TABLE (migration_name TEXT, migration_applied BOOLEAN)
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = pg_catalog, public
AS $function$
  SELECT requested.filename,
         EXISTS (
           SELECT 1
             FROM public.schema_migrations AS applied
            WHERE applied.filename = requested.filename
              AND applied.checksum IS NOT NULL
         )
         AND (
           requested.filename <> '092_hostel_assignment_uniqueness.sql'
           OR (
             public.proctira_hostel_assignment_index_ready(
               'uq_hostel_assignments_active_bed',
               'bed_id'
             )
             AND public.proctira_hostel_assignment_index_ready(
               'uq_hostel_assignments_active_student',
               'student_id'
             )
           )
         ) AS migration_applied
    FROM unnest(COALESCE(required_filenames, ARRAY[]::TEXT[])) WITH ORDINALITY
      AS requested(filename, position)
   WHERE requested.filename ~ '^[0-9][0-9A-Za-z_]*\.sql$'
   ORDER BY requested.position
$function$;

REVOKE ALL ON FUNCTION public.proctira_runtime_migration_status(TEXT[]) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.proctira_runtime_migration_status(TEXT[]) TO proctira_app;

COMMENT ON FUNCTION public.proctira_runtime_migration_status(TEXT[]) IS
  'UP-P0-02: read-only migration/integrity readiness for proctira_app; does not expose checksums.';
