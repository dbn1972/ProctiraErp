-- W1-DATA-15 complete residual — Prisma FORCE-RLS tables: ADD NOT VALID only.
--
-- student_attendance / assessment_results / examination_* / staff_attendance
-- historically used current_setting('app.current_tenant_id') without missing_ok
-- and without a platform_admin escape. Under FORCE RLS, migrator VALIDATE either
-- throws or cannot see cross-tenant rows (false-clean scan).
--
-- Safe pattern (documented in DATA_W1_DATA_15_COMPLETE.md):
--   ADD … NOT VALID  — new INSERT/UPDATE still reject dangling parent UUIDs
--   Do NOT ship a VALIDATE companion for these names in this wave
--
-- Full-scan VALIDATE remains an operator task (BYPASSRLS / superuser) after
-- orphan cleanup, or after a future policy rewrite that adds platform_admin +
-- missing_ok (out of scope for this residual).
--
-- Idempotent: skips when constraint exists or column already has any FK.

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
        ('student_attendance', 'student_id', 'student_attendance_student_id_fkey',
         'FOREIGN KEY (student_id) REFERENCES students(id)'),
        ('assessment_results', 'student_id', 'assessment_results_student_id_fkey',
         'FOREIGN KEY (student_id) REFERENCES students(id)'),
        ('examination_candidate_registrations', 'student_id',
         'examination_candidate_registrations_student_id_fkey',
         'FOREIGN KEY (student_id) REFERENCES students(id)'),
        ('examination_candidates', 'student_id', 'examination_candidates_student_id_fkey',
         'FOREIGN KEY (student_id) REFERENCES students(id)'),
        ('examination_academic_records', 'student_id',
         'examination_academic_records_student_id_fkey',
         'FOREIGN KEY (student_id) REFERENCES students(id)'),
        ('staff_attendance', 'staff_id', 'staff_attendance_staff_id_fkey',
         'FOREIGN KEY (staff_id) REFERENCES staff(id)')
    ) AS t(table_name, column_name, constraint_name, def)
  LOOP
    IF to_regclass('public.' || r.table_name) IS NULL THEN
      RAISE NOTICE 'W1-DATA-15 prisma: skip % (table missing)', r.constraint_name;
      CONTINUE;
    END IF;

    IF NOT EXISTS (
      SELECT 1
      FROM information_schema.columns c
      WHERE c.table_schema = 'public'
        AND c.table_name = r.table_name
        AND c.column_name = r.column_name
    ) THEN
      RAISE NOTICE 'W1-DATA-15 prisma: skip % (column missing)', r.constraint_name;
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
      RAISE NOTICE 'W1-DATA-15 prisma: skip % (column already has FK)', r.constraint_name;
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
VALUES ('087_cross_domain_fk_prisma_not_valid.sql')
ON CONFLICT (filename) DO NOTHING;
