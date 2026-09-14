-- W1-DATA-14 residual / REGRESSED — harden enrollment + grade audit completeness.
--
-- Prior 071_enrollment_grade_audit_completeness.sql shipped write triggers,
-- append-only guards, and REVOKE. Auditor gaps that left the finding REGRESSED:
--   1. grade_change_audit FK used ON DELETE CASCADE (parent delete can erase audit
--      if append-only triggers are ever dropped; RESTRICT is the durable posture)
--   2. enrollment_history → enrollments FK still CASCADE from 021
--   3. write trigger functions lacked SECURITY DEFINER + fixed search_path
--      (search_path hijack / privilege edge cases could skip audit inserts)
--   4. REVOKE not re-asserted after later privilege churn (050 re-run class)
--
-- This file is additive / idempotent. Do not edit 071 (checksum ledger).

CREATE EXTENSION IF NOT EXISTS "uuid-ossp";

-- ---------------------------------------------------------------------------
-- 1. Audit / history FKs: RESTRICT (never CASCADE-erase audit trails)
-- ---------------------------------------------------------------------------
DO $$
DECLARE
  r RECORD;
BEGIN
  -- enrollment_history.enrollment_id
  FOR r IN
    SELECT c.conname
    FROM pg_constraint c
    JOIN pg_class rel ON rel.oid = c.conrelid
    JOIN pg_namespace nsp ON nsp.oid = rel.relnamespace
    WHERE nsp.nspname = 'public'
      AND rel.relname = 'enrollment_history'
      AND c.contype = 'f'
      AND pg_get_constraintdef(c.oid) ILIKE '%enrollment_id%REFERENCES%enrollments%'
  LOOP
    EXECUTE format('ALTER TABLE enrollment_history DROP CONSTRAINT %I', r.conname);
  END LOOP;

  ALTER TABLE enrollment_history
    ADD CONSTRAINT enrollment_history_enrollment_id_fkey
    FOREIGN KEY (enrollment_id) REFERENCES enrollments(id)
    ON DELETE RESTRICT;

  -- grade_change_audit.grade_entry_id (both 071 / DATA-15 names)
  FOR r IN
    SELECT c.conname
    FROM pg_constraint c
    JOIN pg_class rel ON rel.oid = c.conrelid
    JOIN pg_namespace nsp ON nsp.oid = rel.relnamespace
    WHERE nsp.nspname = 'public'
      AND rel.relname = 'grade_change_audit'
      AND c.contype = 'f'
      AND pg_get_constraintdef(c.oid) ILIKE '%grade_entry_id%REFERENCES%grade_entries%'
  LOOP
    EXECUTE format('ALTER TABLE grade_change_audit DROP CONSTRAINT %I', r.conname);
  END LOOP;

  ALTER TABLE grade_change_audit
    ADD CONSTRAINT grade_change_audit_grade_entry_id_fkey
    FOREIGN KEY (grade_entry_id) REFERENCES grade_entries(id)
    ON DELETE RESTRICT
    NOT VALID;
END $$;

DO $$
BEGIN
  IF EXISTS (
    SELECT 1 FROM grade_change_audit a
    WHERE NOT EXISTS (SELECT 1 FROM grade_entries g WHERE g.id = a.grade_entry_id)
  ) THEN
    RAISE NOTICE
      'W1-DATA-14: skipping VALIDATE on grade_change_audit_grade_entry_id_fkey (orphan rows present)';
  ELSE
    ALTER TABLE grade_change_audit
      VALIDATE CONSTRAINT grade_change_audit_grade_entry_id_fkey;
  END IF;
EXCEPTION
  WHEN undefined_object THEN
    NULL;
END $$;

-- ---------------------------------------------------------------------------
-- 2. Re-assert append-only + runtime REVOKE (idempotent)
-- ---------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION enrollment_history_append_only()
RETURNS TRIGGER
LANGUAGE plpgsql
SET search_path = public
AS $$
BEGIN
  RAISE EXCEPTION 'enrollment_history is append-only (% rejected)', TG_OP
    USING ERRCODE = 'integrity_constraint_violation';
END;
$$;

DROP TRIGGER IF EXISTS trg_enrollment_history_append_only ON enrollment_history;
CREATE TRIGGER trg_enrollment_history_append_only
  BEFORE UPDATE OR DELETE ON enrollment_history
  FOR EACH ROW EXECUTE FUNCTION enrollment_history_append_only();

CREATE OR REPLACE FUNCTION grade_change_audit_append_only()
RETURNS TRIGGER
LANGUAGE plpgsql
SET search_path = public
AS $$
BEGIN
  RAISE EXCEPTION 'grade_change_audit is append-only (% rejected)', TG_OP
    USING ERRCODE = 'integrity_constraint_violation';
END;
$$;

DROP TRIGGER IF EXISTS trg_grade_change_audit_append_only ON grade_change_audit;
CREATE TRIGGER trg_grade_change_audit_append_only
  BEFORE UPDATE OR DELETE ON grade_change_audit
  FOR EACH ROW EXECUTE FUNCTION grade_change_audit_append_only();

DO $$
BEGIN
  IF EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'proctira_app') THEN
    -- Narrow mutate rights; keep SELECT + INSERT for reads / optional enrichment.
    REVOKE ALL ON enrollment_history FROM proctira_app;
    GRANT SELECT, INSERT ON enrollment_history TO proctira_app;

    REVOKE ALL ON grade_change_audit FROM proctira_app;
    GRANT SELECT, INSERT ON grade_change_audit TO proctira_app;
  END IF;
END $$;

-- ---------------------------------------------------------------------------
-- 3. Write triggers: SECURITY DEFINER + fixed search_path (cannot skip)
-- ---------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION enrollments_write_history()
RETURNS TRIGGER
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_reason TEXT;
  v_effective DATE;
BEGIN
  IF TG_OP = 'UPDATE' AND OLD.status IS NOT DISTINCT FROM NEW.status THEN
    RETURN NEW;
  END IF;

  v_reason := NULLIF(current_setting('app.enrollment_history_reason', true), '');
  IF v_reason IS NULL THEN
    IF TG_OP = 'INSERT' THEN
      v_reason := 'Initial enrollment (database trigger)';
    ELSE
      v_reason := 'Status change (database trigger)';
    END IF;
  END IF;

  BEGIN
    v_effective := NULLIF(current_setting('app.enrollment_history_effective_date', true), '')::date;
  EXCEPTION WHEN others THEN
    v_effective := NULL;
  END;
  IF v_effective IS NULL THEN
    v_effective := COALESCE(NEW.exited_at, NEW.enrolled_at, CURRENT_DATE);
  END IF;

  INSERT INTO enrollment_history (
    tenant_id,
    enrollment_id,
    previous_status,
    new_status,
    effective_date,
    institution_id,
    academic_period_id,
    reason
  ) VALUES (
    NEW.tenant_id,
    NEW.id,
    CASE WHEN TG_OP = 'INSERT' THEN NULL ELSE OLD.status::text END,
    NEW.status::text,
    v_effective,
    NEW.institution_id,
    NEW.academic_period_id,
    v_reason
  );

  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS trg_enrollments_write_history ON enrollments;
CREATE TRIGGER trg_enrollments_write_history
  AFTER INSERT OR UPDATE OF status ON enrollments
  FOR EACH ROW EXECUTE FUNCTION enrollments_write_history();

CREATE OR REPLACE FUNCTION grade_entries_write_change_audit()
RETURNS TRIGGER
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_action TEXT;
  v_actor TEXT;
  v_from_status TEXT;
  v_to_status TEXT;
  material_changed BOOLEAN;
BEGIN
  IF TG_OP = 'INSERT' THEN
    material_changed := TRUE;
  ELSE
    material_changed :=
      OLD.numeric_score IS DISTINCT FROM NEW.numeric_score
      OR OLD.letter_grade IS DISTINCT FROM NEW.letter_grade
      OR OLD.locked_at IS DISTINCT FROM NEW.locked_at
      OR OLD.published_at IS DISTINCT FROM NEW.published_at
      OR COALESCE(OLD.metadata->>'workflowStatus', '')
           IS DISTINCT FROM COALESCE(NEW.metadata->>'workflowStatus', '');
  END IF;

  IF NOT material_changed THEN
    RETURN NEW;
  END IF;

  v_from_status := CASE
    WHEN TG_OP = 'INSERT' THEN NULL
    ELSE NULLIF(OLD.metadata->>'workflowStatus', '')
  END;
  v_to_status := NULLIF(NEW.metadata->>'workflowStatus', '');
  IF v_to_status IS NULL AND NEW.published_at IS NOT NULL THEN
    v_to_status := 'PUBLISHED';
  ELSIF v_to_status IS NULL AND NEW.locked_at IS NOT NULL THEN
    v_to_status := 'LOCKED';
  ELSIF v_to_status IS NULL THEN
    v_to_status := 'DRAFT';
  END IF;

  v_action := NULLIF(current_setting('app.grade_change_action', true), '');
  IF v_action IS NULL THEN
    IF TG_OP = 'INSERT' THEN
      v_action := 'grade.insert';
    ELSIF COALESCE(OLD.metadata->>'workflowStatus', '')
            IS DISTINCT FROM COALESCE(NEW.metadata->>'workflowStatus', '')
          OR OLD.locked_at IS DISTINCT FROM NEW.locked_at
          OR OLD.published_at IS DISTINCT FROM NEW.published_at THEN
      v_action := 'grade.workflow';
    ELSE
      v_action := 'grade.score_change';
    END IF;
  END IF;

  v_actor := NULLIF(current_setting('app.grade_change_actor_id', true), '');
  IF v_actor IS NULL AND NEW.entered_by IS NOT NULL THEN
    v_actor := NEW.entered_by::text;
  END IF;

  INSERT INTO grade_change_audit (
    tenant_id,
    grade_entry_id,
    action,
    from_status,
    to_status,
    from_numeric_score,
    to_numeric_score,
    from_letter_grade,
    to_letter_grade,
    actor_id,
    details
  ) VALUES (
    NEW.tenant_id,
    NEW.id,
    v_action,
    v_from_status,
    v_to_status,
    CASE WHEN TG_OP = 'INSERT' THEN NULL ELSE OLD.numeric_score END,
    NEW.numeric_score,
    CASE WHEN TG_OP = 'INSERT' THEN NULL ELSE OLD.letter_grade END,
    NEW.letter_grade,
    v_actor,
    jsonb_build_object(
      'source', 'database_trigger',
      'op', TG_OP
    )
  );

  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS trg_grade_entries_write_change_audit ON grade_entries;
CREATE TRIGGER trg_grade_entries_write_change_audit
  AFTER INSERT OR UPDATE ON grade_entries
  FOR EACH ROW EXECUTE FUNCTION grade_entries_write_change_audit();

INSERT INTO schema_migrations (filename)
VALUES ('080_enrollment_grade_audit_harden.sql')
ON CONFLICT (filename) DO NOTHING;
