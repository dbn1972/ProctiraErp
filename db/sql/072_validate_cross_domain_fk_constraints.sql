-- W1-DATA-15 — VALIDATE cross-domain FKs added as NOT VALID in 071.
--
-- Validates the closed-set constraint names from 071. Sets platform_admin so
-- parent lookups on students/tenants policies that allow it can see rows.
-- Same FORCE-RLS honesty as W1-DATA-06 / 068: migrator VALIDATE is best-effort
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
    'parent_child_links_student_id_fkey',
    'parent_consents_student_id_fkey',
    'parent_message_threads_student_id_fkey',
    'parent_fee_invoices_student_id_fkey',
    'fee_concessions_student_id_fkey',
    'fee_reminder_send_audits_student_id_fkey',
    'fee_reminder_suppressions_student_id_fkey',
    'guardian_student_custody_student_id_fkey',
    'report_card_jobs_student_id_fkey',
    'report_card_teacher_comments_student_id_fkey',
    'admission_offers_enrolled_student_id_fkey',
    'transfer_records_student_id_fkey',
    'attendance_regularisation_requests_student_id_fkey',
    'attendance_leave_requests_student_id_fkey',
    'attendance_ingest_events_student_id_fkey',
    'transfer_records_source_enrollment_id_fkey',
    'transfer_records_destination_enrollment_id_fkey',
    'fee_ledger_entries_invoice_id_fkey',
    'fee_reconciliation_rows_invoice_id_fkey',
    'fee_reminder_send_audits_invoice_id_fkey',
    'fee_reminder_suppressions_invoice_id_fkey',
    'admission_offers_offer_fee_invoice_id_fkey',
    'parent_fee_invoices_structure_id_fkey',
    'parent_fee_invoices_grade_id_fkey',
    'fee_structures_grade_id_fkey',
    'admission_offers_grade_id_fkey',
    'admission_enquiries_grade_id_fkey',
    'admission_applications_grade_id_fkey',
    'merit_lists_grade_id_fkey',
    'seat_matrix_grade_id_fkey',
    'syllabus_units_grade_id_fkey',
    'learning_outcomes_grade_id_fkey',
    'grade_change_audit_grade_entry_id_fkey'
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
VALUES ('072_validate_cross_domain_fk_constraints.sql')
ON CONFLICT (filename) DO NOTHING;
