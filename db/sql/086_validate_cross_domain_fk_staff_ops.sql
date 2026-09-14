-- W1-DATA-15 complete residual — VALIDATE staff/HR/transport-fee FKs from 076.
--
-- Validates the closed-set constraint names from 076. Sets platform_admin so
-- parent lookups on staff / fee tables that allow it can see rows.
-- Same FORCE-RLS honesty as 072 / 074 / 068: migrator VALIDATE is best-effort
-- under RLS; operators may re-run as a BYPASSRLS/superuser role for a full scan.
--
-- Idempotent no-op when already validated. Missing constraints are skipped.

DO $$ BEGIN
  PERFORM set_config('app.platform_admin', '1', true);
END $$;

DO $$
DECLARE
  r RECORD;
  names text[] := ARRAY[
    'staff_leave_requests_staff_id_fkey',
    'staff_leave_balances_staff_id_fkey',
    'staff_contracts_staff_id_fkey',
    'staff_qualifications_staff_id_fkey',
    'staff_hr_attendance_staff_id_fkey',
    'staff_payroll_lines_staff_id_fkey',
    'hr_appraisals_staff_id_fkey',
    'hr_training_attendance_staff_id_fkey',
    'hr_certifications_staff_id_fkey',
    'timetable_teacher_absences_staff_id_fkey',
    'exam_invigilators_staff_id_fkey',
    'transport_fee_links_fees_invoice_id_fkey',
    'transport_fee_links_fees_structure_id_fkey',
    'transport_fee_structures_fees_structure_id_fkey'
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
VALUES ('086_validate_cross_domain_fk_staff_ops.sql')
ON CONFLICT (filename) DO NOTHING;
