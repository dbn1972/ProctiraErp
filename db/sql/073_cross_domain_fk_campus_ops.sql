-- W1-DATA-15 residual — campus / ops student_id FKs (hostel, library, LMS,
-- transport, health nurse incidents, exam seating).
--
-- Wave-1 closed the highest-value fee/SIS/parent refs in 071 + 072. This file
-- closes the honest residual: UUID student_id columns that still permitted
-- in-tenant dangling relationships.
--
-- Pattern (same as 071 / W1-DATA-06):
--   1) ADD … NOT VALID  — new writes checked immediately; existing rows deferred
--   2) 074_validate_cross_domain_fk_campus_ops.sql VALIDATEs when clean
--
-- Idempotent: skips when the named constraint already exists, or when the
-- column already has any foreign key. Tables absent on the target DB are skipped.
--
-- Demo student …099 is upserted in 071 (and library/parent seeds) so VALIDATE
-- succeeds after APPLY_SEEDS=1 when loans/holds reference that UUID.

DO $$ BEGIN
  PERFORM set_config('app.platform_admin', '1', true);
END $$;

DO $$
DECLARE
  r RECORD;
BEGIN
  FOR r IN
    SELECT *
    FROM (
      VALUES
        -- Hostel core + ops
        ('hostel_assignments', 'student_id', 'hostel_assignments_student_id_fkey',
         'FOREIGN KEY (student_id) REFERENCES students(id)'),
        ('hostel_leaves', 'student_id', 'hostel_leaves_student_id_fkey',
         'FOREIGN KEY (student_id) REFERENCES students(id)'),
        ('hostel_visitors', 'student_id', 'hostel_visitors_student_id_fkey',
         'FOREIGN KEY (student_id) REFERENCES students(id)'),
        ('mess_subscriptions', 'student_id', 'mess_subscriptions_student_id_fkey',
         'FOREIGN KEY (student_id) REFERENCES students(id)'),
        ('gate_passes', 'student_id', 'gate_passes_student_id_fkey',
         'FOREIGN KEY (student_id) REFERENCES students(id)'),
        ('hostel_attendance', 'student_id', 'hostel_attendance_student_id_fkey',
         'FOREIGN KEY (student_id) REFERENCES students(id)'),

        -- Library core + ops
        ('library_loans', 'student_id', 'library_loans_student_id_fkey',
         'FOREIGN KEY (student_id) REFERENCES students(id)'),
        ('library_holds', 'student_id', 'library_holds_student_id_fkey',
         'FOREIGN KEY (student_id) REFERENCES students(id)'),
        ('library_fines', 'student_id', 'library_fines_student_id_fkey',
         'FOREIGN KEY (student_id) REFERENCES students(id)'),

        -- LMS mastery / submissions
        ('lms_submissions', 'student_id', 'lms_submissions_student_id_fkey',
         'FOREIGN KEY (student_id) REFERENCES students(id)'),
        ('lms_skill_mastery', 'student_id', 'lms_skill_mastery_student_id_fkey',
         'FOREIGN KEY (student_id) REFERENCES students(id)'),
        ('lms_practice_attempts', 'student_id', 'lms_practice_attempts_student_id_fkey',
         'FOREIGN KEY (student_id) REFERENCES students(id)'),

        -- Transport core + ops
        ('transport_student_assignments', 'student_id', 'transport_student_assignments_student_id_fkey',
         'FOREIGN KEY (student_id) REFERENCES students(id)'),
        ('transport_bus_attendance', 'student_id', 'transport_bus_attendance_student_id_fkey',
         'FOREIGN KEY (student_id) REFERENCES students(id)'),
        ('transport_alerts', 'student_id', 'transport_alerts_student_id_fkey',
         'FOREIGN KEY (student_id) REFERENCES students(id)'),
        ('transport_fee_links', 'student_id', 'transport_fee_links_student_id_fkey',
         'FOREIGN KEY (student_id) REFERENCES students(id)'),

        -- Health nurse incidents (UUID student_id — TEXT counselling ids remain residual)
        ('health_nurse_incidents', 'student_id', 'health_nurse_incidents_student_id_fkey',
         'FOREIGN KEY (student_id) REFERENCES students(id)'),

        -- Examination seating
        ('exam_seating', 'student_id', 'exam_seating_student_id_fkey',
         'FOREIGN KEY (student_id) REFERENCES students(id)')
    ) AS t(table_name, column_name, constraint_name, def)
  LOOP
    IF to_regclass('public.' || r.table_name) IS NULL THEN
      RAISE NOTICE 'W1-DATA-15 campus: skip % (table missing)', r.constraint_name;
      CONTINUE;
    END IF;

    IF NOT EXISTS (
      SELECT 1
      FROM information_schema.columns c
      WHERE c.table_schema = 'public'
        AND c.table_name = r.table_name
        AND c.column_name = r.column_name
    ) THEN
      RAISE NOTICE 'W1-DATA-15 campus: skip % (column missing)', r.constraint_name;
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
      RAISE NOTICE 'W1-DATA-15 campus: skip % (column already has FK)', r.constraint_name;
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
VALUES ('073_cross_domain_fk_campus_ops.sql')
ON CONFLICT (filename) DO NOTHING;
