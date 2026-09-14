-- W1-DATA-15 complete residual — staff / HR / transport-fee cross-domain FKs.
--
-- Wave-1 (071/072) closed fee/SIS/parent student refs. Campus ops (073/074)
-- closed hostel/library/LMS/transport/health/exam student_id. This file closes
-- the remaining high-value auditor residual: bare UUID staff_id (and transport
-- fee invoice/structure links) that still permitted in-tenant dangling rows.
--
-- Pattern (same as 071 / 073 / W1-DATA-06):
--   1) ADD … NOT VALID  — new writes checked immediately; existing rows deferred
--   2) 086_validate_cross_domain_fk_staff_ops.sql VALIDATEs when clean
--
-- Idempotent: skips when the named constraint already exists, or when the
-- column already has any foreign key. Tables absent on the target DB are skipped.
--
-- Prisma FORCE-RLS hazardous tables (student_attendance / assessment_results /
-- examination_* student_id) are handled separately in 078 (NOT VALID only).

DO $$ BEGIN
  PERFORM set_config('app.platform_admin', '1', true);
END $$;

-- Demo staff row so VALIDATE can succeed if any seed later references …098.
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

INSERT INTO staff (
  id, tenant_id, first_name, last_name, date_of_birth, identity_number
) VALUES (
  '00000000-0000-4000-8000-000000000098',
  '00000000-0000-4000-8000-000000000001',
  'Demo',
  'Staff',
  DATE '1988-03-12',
  'FK-DEMO-STAFF-098'
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
        -- Staff / HR leave + contracts
        ('staff_leave_requests', 'staff_id', 'staff_leave_requests_staff_id_fkey',
         'FOREIGN KEY (staff_id) REFERENCES staff(id)'),
        ('staff_leave_balances', 'staff_id', 'staff_leave_balances_staff_id_fkey',
         'FOREIGN KEY (staff_id) REFERENCES staff(id)'),
        ('staff_contracts', 'staff_id', 'staff_contracts_staff_id_fkey',
         'FOREIGN KEY (staff_id) REFERENCES staff(id)'),
        ('staff_qualifications', 'staff_id', 'staff_qualifications_staff_id_fkey',
         'FOREIGN KEY (staff_id) REFERENCES staff(id)'),
        ('staff_hr_attendance', 'staff_id', 'staff_hr_attendance_staff_id_fkey',
         'FOREIGN KEY (staff_id) REFERENCES staff(id)'),
        ('staff_payroll_lines', 'staff_id', 'staff_payroll_lines_staff_id_fkey',
         'FOREIGN KEY (staff_id) REFERENCES staff(id)'),

        -- HR appraisals / training
        ('hr_appraisals', 'staff_id', 'hr_appraisals_staff_id_fkey',
         'FOREIGN KEY (staff_id) REFERENCES staff(id)'),
        ('hr_training_attendance', 'staff_id', 'hr_training_attendance_staff_id_fkey',
         'FOREIGN KEY (staff_id) REFERENCES staff(id)'),
        ('hr_certifications', 'staff_id', 'hr_certifications_staff_id_fkey',
         'FOREIGN KEY (staff_id) REFERENCES staff(id)'),

        -- Timetable + exam ops staff refs
        ('timetable_teacher_absences', 'staff_id', 'timetable_teacher_absences_staff_id_fkey',
         'FOREIGN KEY (staff_id) REFERENCES staff(id)'),
        ('exam_invigilators', 'staff_id', 'exam_invigilators_staff_id_fkey',
         'FOREIGN KEY (staff_id) REFERENCES staff(id)'),

        -- Transport fee cross-domain links → fees domain
        ('transport_fee_links', 'fees_invoice_id', 'transport_fee_links_fees_invoice_id_fkey',
         'FOREIGN KEY (fees_invoice_id) REFERENCES parent_fee_invoices(id)'),
        ('transport_fee_links', 'fees_structure_id', 'transport_fee_links_fees_structure_id_fkey',
         'FOREIGN KEY (fees_structure_id) REFERENCES fee_structures(id)'),
        ('transport_fee_structures', 'fees_structure_id', 'transport_fee_structures_fees_structure_id_fkey',
         'FOREIGN KEY (fees_structure_id) REFERENCES fee_structures(id)')
    ) AS t(table_name, column_name, constraint_name, def)
  LOOP
    IF to_regclass('public.' || r.table_name) IS NULL THEN
      RAISE NOTICE 'W1-DATA-15 staff-ops: skip % (table missing)', r.constraint_name;
      CONTINUE;
    END IF;

    IF NOT EXISTS (
      SELECT 1
      FROM information_schema.columns c
      WHERE c.table_schema = 'public'
        AND c.table_name = r.table_name
        AND c.column_name = r.column_name
    ) THEN
      RAISE NOTICE 'W1-DATA-15 staff-ops: skip % (column missing)', r.constraint_name;
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
      RAISE NOTICE 'W1-DATA-15 staff-ops: skip % (column already has FK)', r.constraint_name;
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
VALUES ('085_cross_domain_fk_staff_ops.sql')
ON CONFLICT (filename) DO NOTHING;
