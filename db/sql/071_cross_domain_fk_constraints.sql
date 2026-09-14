-- W1-DATA-15 — highest-value cross-domain FKs (student / enrollment / fee / grade).
--
-- Many domain tables still store UUID cross-refs without REFERENCES, so in-tenant
-- dangling relationships are possible (orphan fee invoices, transfer rows, etc.).
--
-- Pattern (same as W1-DATA-06 tenant FKs):
--   1) ADD … NOT VALID  — new writes checked immediately; existing rows deferred
--   2) 072_validate_cross_domain_fk_constraints.sql VALIDATEs when clean
--
-- Idempotent: skips when the named constraint already exists, or when the
-- column already has any foreign key. Tables absent on the target DB are skipped.
--
-- Demo seed repair: *b_*_seed.sql historically referenced student
-- 00000000-0000-4000-8000-000000000099 without inserting it. Upsert that row
-- (and its tenant) so VALIDATE can succeed after APPLY_SEEDS=1.

DO $$ BEGIN
  PERFORM set_config('app.platform_admin', '1', true);
END $$;

INSERT INTO tenants (id, name, slug, config, status)
VALUES (
  '00000000-0000-4000-8000-000000000001',
  'Cross-domain FK demo tenant',
  'cross-domain-fk-demo',
  '{}'::jsonb,
  'active'
)
ON CONFLICT (id) DO UPDATE
  SET status = 'active',
      deleted_at = NULL,
      updated_at = NOW();

INSERT INTO students (
  id, tenant_id, first_name, last_name, date_of_birth, gender
) VALUES (
  '00000000-0000-4000-8000-000000000099',
  '00000000-0000-4000-8000-000000000001',
  'Demo',
  'Student',
  DATE '2012-06-15',
  'unspecified'
)
ON CONFLICT (id) DO NOTHING;

DO $$
DECLARE
  r RECORD;
BEGIN
  FOR r IN
    SELECT *
    FROM (
      VALUES
        -- Parent portal / fees → students
        ('parent_child_links', 'student_id', 'parent_child_links_student_id_fkey',
         'FOREIGN KEY (student_id) REFERENCES students(id)'),
        ('parent_consents', 'student_id', 'parent_consents_student_id_fkey',
         'FOREIGN KEY (student_id) REFERENCES students(id)'),
        ('parent_message_threads', 'student_id', 'parent_message_threads_student_id_fkey',
         'FOREIGN KEY (student_id) REFERENCES students(id)'),
        ('parent_fee_invoices', 'student_id', 'parent_fee_invoices_student_id_fkey',
         'FOREIGN KEY (student_id) REFERENCES students(id)'),
        ('fee_concessions', 'student_id', 'fee_concessions_student_id_fkey',
         'FOREIGN KEY (student_id) REFERENCES students(id)'),
        ('fee_reminder_send_audits', 'student_id', 'fee_reminder_send_audits_student_id_fkey',
         'FOREIGN KEY (student_id) REFERENCES students(id)'),
        ('fee_reminder_suppressions', 'student_id', 'fee_reminder_suppressions_student_id_fkey',
         'FOREIGN KEY (student_id) REFERENCES students(id)'),
        ('guardian_student_custody', 'student_id', 'guardian_student_custody_student_id_fkey',
         'FOREIGN KEY (student_id) REFERENCES students(id)'),
        ('report_card_jobs', 'student_id', 'report_card_jobs_student_id_fkey',
         'FOREIGN KEY (student_id) REFERENCES students(id)'),
        ('report_card_teacher_comments', 'student_id', 'report_card_teacher_comments_student_id_fkey',
         'FOREIGN KEY (student_id) REFERENCES students(id)'),
        ('admission_offers', 'enrolled_student_id', 'admission_offers_enrolled_student_id_fkey',
         'FOREIGN KEY (enrolled_student_id) REFERENCES students(id)'),
        ('transfer_records', 'student_id', 'transfer_records_student_id_fkey',
         'FOREIGN KEY (student_id) REFERENCES students(id)'),
        ('attendance_regularisation_requests', 'student_id', 'attendance_regularisation_requests_student_id_fkey',
         'FOREIGN KEY (student_id) REFERENCES students(id)'),
        ('attendance_leave_requests', 'student_id', 'attendance_leave_requests_student_id_fkey',
         'FOREIGN KEY (student_id) REFERENCES students(id)'),
        ('attendance_ingest_events', 'student_id', 'attendance_ingest_events_student_id_fkey',
         'FOREIGN KEY (student_id) REFERENCES students(id)'),
        -- NOTE: Prisma `student_attendance` / `assessment_results` use
        -- current_setting('app.current_tenant_id') without missing_ok and without
        -- platform_admin escape. Migrator VALIDATE under FORCE RLS throws or
        -- cannot see cross-tenant rows — left as residual (see audit).

        -- Enrollment transfers
        ('transfer_records', 'source_enrollment_id', 'transfer_records_source_enrollment_id_fkey',
         'FOREIGN KEY (source_enrollment_id) REFERENCES enrollments(id)'),
        ('transfer_records', 'destination_enrollment_id', 'transfer_records_destination_enrollment_id_fkey',
         'FOREIGN KEY (destination_enrollment_id) REFERENCES enrollments(id)'),

        -- Fee invoice / structure refs
        ('fee_ledger_entries', 'invoice_id', 'fee_ledger_entries_invoice_id_fkey',
         'FOREIGN KEY (invoice_id) REFERENCES parent_fee_invoices(id)'),
        ('fee_reconciliation_rows', 'invoice_id', 'fee_reconciliation_rows_invoice_id_fkey',
         'FOREIGN KEY (invoice_id) REFERENCES parent_fee_invoices(id)'),
        ('fee_reminder_send_audits', 'invoice_id', 'fee_reminder_send_audits_invoice_id_fkey',
         'FOREIGN KEY (invoice_id) REFERENCES parent_fee_invoices(id)'),
        ('fee_reminder_suppressions', 'invoice_id', 'fee_reminder_suppressions_invoice_id_fkey',
         'FOREIGN KEY (invoice_id) REFERENCES parent_fee_invoices(id)'),
        ('admission_offers', 'offer_fee_invoice_id', 'admission_offers_offer_fee_invoice_id_fkey',
         'FOREIGN KEY (offer_fee_invoice_id) REFERENCES parent_fee_invoices(id)'),
        ('parent_fee_invoices', 'structure_id', 'parent_fee_invoices_structure_id_fkey',
         'FOREIGN KEY (structure_id) REFERENCES fee_structures(id)'),

        -- Grade / grade-entry refs
        ('parent_fee_invoices', 'grade_id', 'parent_fee_invoices_grade_id_fkey',
         'FOREIGN KEY (grade_id) REFERENCES grades(id)'),
        ('fee_structures', 'grade_id', 'fee_structures_grade_id_fkey',
         'FOREIGN KEY (grade_id) REFERENCES grades(id)'),
        ('admission_offers', 'grade_id', 'admission_offers_grade_id_fkey',
         'FOREIGN KEY (grade_id) REFERENCES grades(id)'),
        ('admission_enquiries', 'grade_id', 'admission_enquiries_grade_id_fkey',
         'FOREIGN KEY (grade_id) REFERENCES grades(id)'),
        ('admission_applications', 'grade_id', 'admission_applications_grade_id_fkey',
         'FOREIGN KEY (grade_id) REFERENCES grades(id)'),
        ('merit_lists', 'grade_id', 'merit_lists_grade_id_fkey',
         'FOREIGN KEY (grade_id) REFERENCES grades(id)'),
        ('seat_matrix', 'grade_id', 'seat_matrix_grade_id_fkey',
         'FOREIGN KEY (grade_id) REFERENCES grades(id)'),
        ('syllabus_units', 'grade_id', 'syllabus_units_grade_id_fkey',
         'FOREIGN KEY (grade_id) REFERENCES grades(id)'),
        ('learning_outcomes', 'grade_id', 'learning_outcomes_grade_id_fkey',
         'FOREIGN KEY (grade_id) REFERENCES grades(id)'),
        ('grade_change_audit', 'grade_entry_id', 'grade_change_audit_grade_entry_id_fkey',
         'FOREIGN KEY (grade_entry_id) REFERENCES grade_entries(id)')
    ) AS t(table_name, column_name, constraint_name, def)
  LOOP
    IF to_regclass('public.' || r.table_name) IS NULL THEN
      RAISE NOTICE 'W1-DATA-15: skip % (table missing)', r.constraint_name;
      CONTINUE;
    END IF;

    IF NOT EXISTS (
      SELECT 1
      FROM information_schema.columns c
      WHERE c.table_schema = 'public'
        AND c.table_name = r.table_name
        AND c.column_name = r.column_name
    ) THEN
      RAISE NOTICE 'W1-DATA-15: skip % (column missing)', r.constraint_name;
      CONTINUE;
    END IF;

    IF EXISTS (
      SELECT 1
      FROM pg_constraint c
      JOIN pg_class rel ON rel.oid = c.conrelid
      JOIN pg_namespace nsp ON nsp.oid = rel.relnamespace
      WHERE nsp.nspname = 'public'
        AND rel.relname = r.table_name
        AND c.conname = r.constraint_name
    ) THEN
      CONTINUE;
    END IF;

    -- Skip when the column already participates in any FK (any constraint name).
    IF EXISTS (
      SELECT 1
      FROM information_schema.table_constraints tc
      JOIN information_schema.key_column_usage kcu
        ON kcu.constraint_name = tc.constraint_name
       AND kcu.table_schema = tc.table_schema
       AND kcu.table_name = tc.table_name
      WHERE tc.table_schema = 'public'
        AND tc.table_name = r.table_name
        AND tc.constraint_type = 'FOREIGN KEY'
        AND kcu.column_name = r.column_name
    ) THEN
      RAISE NOTICE 'W1-DATA-15: skip % (column already has FK)', r.constraint_name;
      CONTINUE;
    END IF;

    EXECUTE format(
      'ALTER TABLE %I ADD CONSTRAINT %I %s NOT VALID',
      r.table_name,
      r.constraint_name,
      r.def
    );
  END LOOP;
END $$;

INSERT INTO schema_migrations (filename)
VALUES ('071_cross_domain_fk_constraints.sql')
ON CONFLICT (filename) DO NOTHING;
