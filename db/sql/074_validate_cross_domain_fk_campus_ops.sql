-- W1-DATA-15 residual — VALIDATE campus/ops student_id FKs from 073.
--
-- Validates the closed-set constraint names from 073. Sets platform_admin so
-- parent lookups on students policies that allow it can see rows.
-- Same FORCE-RLS honesty as 072 / 068: migrator VALIDATE is best-effort under
-- RLS; operators may re-run as a BYPASSRLS/superuser role for a full scan.
--
-- Idempotent no-op when already validated. Missing constraints are skipped.

DO $$ BEGIN
  PERFORM set_config('app.platform_admin', '1', true);
END $$;

DO $$
DECLARE
  r RECORD;
  names text[] := ARRAY[
    'hostel_assignments_student_id_fkey',
    'hostel_leaves_student_id_fkey',
    'hostel_visitors_student_id_fkey',
    'mess_subscriptions_student_id_fkey',
    'gate_passes_student_id_fkey',
    'hostel_attendance_student_id_fkey',
    'library_loans_student_id_fkey',
    'library_holds_student_id_fkey',
    'library_fines_student_id_fkey',
    'lms_submissions_student_id_fkey',
    'lms_skill_mastery_student_id_fkey',
    'lms_practice_attempts_student_id_fkey',
    'transport_student_assignments_student_id_fkey',
    'transport_bus_attendance_student_id_fkey',
    'transport_alerts_student_id_fkey',
    'transport_fee_links_student_id_fkey',
    'health_nurse_incidents_student_id_fkey',
    'exam_seating_student_id_fkey'
  ];
BEGIN
  FOR r IN
    SELECT
      c.conrelid::regclass AS table_reg,
      c.conname AS constraint_name
    FROM pg_constraint c
    JOIN pg_class rel ON rel.oid = c.conrelid
    JOIN pg_namespace nsp ON nsp.oid = rel.relnamespace
    WHERE c.contype = 'f'
      AND NOT c.convalidated
      AND nsp.nspname = 'public'
      AND c.conname = ANY (names)
  LOOP
    EXECUTE format(
      'ALTER TABLE %s VALIDATE CONSTRAINT %I',
      r.table_reg,
      r.constraint_name
    );
  END LOOP;
END $$;

INSERT INTO schema_migrations (filename)
VALUES ('074_validate_cross_domain_fk_campus_ops.sql')
ON CONFLICT (filename) DO NOTHING;
