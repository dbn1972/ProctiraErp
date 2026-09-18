-- W1-DATA-14 closure — one audit authority and validated parent integrity.
--
-- 080 can be recorded while grade_change_audit_grade_entry_id_fkey remains
-- NOT VALID when legacy orphan rows exist. Runtime INSERT also allows a future
-- application path to append a second row after the database trigger. This
-- forward migration:
--   1. transactionally moves legacy grade-audit orphans into an immutable,
--      runtime-denied quarantine without discarding their original payload;
--   2. repairs the canonical grade-entry FK with ADD ... NOT VALID when needed,
--      then validates and catalog-asserts both audit parent FKs; and
--   3. makes both trigger-owned audit tables SELECT-only for proctira_app.
--
-- apply-sql.sh runs each numbered file in one transaction. The reconciliation
-- DO block is also a single PostgreSQL statement so its temporary trigger/RLS
-- changes roll back together even when this file is executed directly.

CREATE TABLE IF NOT EXISTS grade_change_audit_orphan_quarantine (
  source_audit_id UUID PRIMARY KEY,
  tenant_id UUID NOT NULL,
  grade_entry_id UUID NOT NULL,
  source_row JSONB NOT NULL,
  quarantine_reason TEXT NOT NULL,
  source_migration TEXT NOT NULL,
  quarantined_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  CONSTRAINT grade_change_audit_orphan_quarantine_source_shape CHECK (
    source_row->>'id' = source_audit_id::text
    AND source_row->>'tenant_id' = tenant_id::text
    AND source_row->>'grade_entry_id' = grade_entry_id::text
  )
);

ALTER TABLE grade_change_audit_orphan_quarantine ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS tenant_isolation ON grade_change_audit_orphan_quarantine;
CREATE POLICY tenant_isolation ON grade_change_audit_orphan_quarantine
  FOR ALL
  USING (
    tenant_id::text = NULLIF(current_setting('app.tenant_id', true), '')
    OR current_setting('app.platform_admin', true) = '1'
  )
  WITH CHECK (
    tenant_id::text = NULLIF(current_setting('app.tenant_id', true), '')
    OR current_setting('app.platform_admin', true) = '1'
  );
ALTER TABLE grade_change_audit_orphan_quarantine FORCE ROW LEVEL SECURITY;

CREATE OR REPLACE FUNCTION grade_change_audit_orphan_quarantine_append_only()
RETURNS TRIGGER
LANGUAGE plpgsql
SET search_path = public
AS $$
BEGIN
  RAISE EXCEPTION 'grade_change_audit_orphan_quarantine is append-only (% rejected)', TG_OP
    USING ERRCODE = 'integrity_constraint_violation';
END;
$$;

DROP TRIGGER IF EXISTS trg_grade_change_audit_orphan_quarantine_append_only
  ON grade_change_audit_orphan_quarantine;
CREATE TRIGGER trg_grade_change_audit_orphan_quarantine_append_only
  BEFORE UPDATE OR DELETE ON grade_change_audit_orphan_quarantine
  FOR EACH ROW EXECUTE FUNCTION grade_change_audit_orphan_quarantine_append_only();

REVOKE ALL ON grade_change_audit_orphan_quarantine FROM PUBLIC;

-- Move legacy orphans without losing evidence. FORCE RLS is relaxed only for
-- the table-owning migrator inside this atomic DO statement; the prior posture
-- is restored before the statement completes. A duplicate quarantine key or
-- any other error rolls the move and temporary DDL back together.
DO $$
DECLARE
  v_audit_force BOOLEAN;
  v_parent_force BOOLEAN;
  v_quarantined BIGINT;
BEGIN
  PERFORM set_config('app.platform_admin', '1', true);

  SELECT relforcerowsecurity
  INTO v_audit_force
  FROM pg_class
  WHERE oid = 'public.grade_change_audit'::regclass;

  SELECT relforcerowsecurity
  INTO v_parent_force
  FROM pg_class
  WHERE oid = 'public.grade_entries'::regclass;

  IF v_audit_force THEN
    EXECUTE 'ALTER TABLE grade_change_audit NO FORCE ROW LEVEL SECURITY';
  END IF;
  IF v_parent_force THEN
    EXECUTE 'ALTER TABLE grade_entries NO FORCE ROW LEVEL SECURITY';
  END IF;

  EXECUTE 'ALTER TABLE grade_change_audit DISABLE TRIGGER trg_grade_change_audit_append_only';

  WITH orphaned AS (
    DELETE FROM grade_change_audit a
    WHERE NOT EXISTS (
      SELECT 1
      FROM grade_entries g
      WHERE g.id = a.grade_entry_id
    )
    RETURNING a.*
  )
  INSERT INTO grade_change_audit_orphan_quarantine (
    source_audit_id,
    tenant_id,
    grade_entry_id,
    source_row,
    quarantine_reason,
    source_migration
  )
  SELECT
    orphaned.id,
    orphaned.tenant_id,
    orphaned.grade_entry_id,
    to_jsonb(orphaned),
    'Missing grade_entries parent during W1-DATA-14 FK validation',
    '096_w1_data_14_audit_fk_integrity.sql'
  FROM orphaned;

  GET DIAGNOSTICS v_quarantined = ROW_COUNT;

  IF EXISTS (
    SELECT 1
    FROM grade_change_audit a
    WHERE NOT EXISTS (
      SELECT 1
      FROM grade_entries g
      WHERE g.id = a.grade_entry_id
    )
  ) THEN
    RAISE EXCEPTION 'W1-DATA-14: grade_change_audit orphans remain after quarantine';
  END IF;

  EXECUTE 'ALTER TABLE grade_change_audit ENABLE TRIGGER trg_grade_change_audit_append_only';

  IF v_parent_force THEN
    EXECUTE 'ALTER TABLE grade_entries FORCE ROW LEVEL SECURITY';
  END IF;
  IF v_audit_force THEN
    EXECUTE 'ALTER TABLE grade_change_audit FORCE ROW LEVEL SECURITY';
  END IF;

  RAISE NOTICE 'W1-DATA-14: quarantined % orphan grade audit row(s)', v_quarantined;
END $$;

-- Preserve a correct 080 FK without churn. If the catalog shape drifted, drop
-- every FK that includes grade_entry_id and recreate the canonical constraint
-- as NOT VALID before the explicit validation pass below.
DO $$
DECLARE
  r RECORD;
  v_fk_count INTEGER;
  v_expected BOOLEAN;
BEGIN
  SELECT COUNT(*)
  INTO v_fk_count
  FROM pg_constraint c
  JOIN pg_class rel ON rel.oid = c.conrelid
  JOIN pg_namespace nsp ON nsp.oid = rel.relnamespace
  JOIN pg_attribute child_col
    ON child_col.attrelid = c.conrelid
   AND child_col.attnum = ANY (c.conkey)
  WHERE c.contype = 'f'
    AND nsp.nspname = 'public'
    AND rel.relname = 'grade_change_audit'
    AND child_col.attname = 'grade_entry_id';

  SELECT EXISTS (
    SELECT 1
    FROM pg_constraint c
    JOIN pg_class rel ON rel.oid = c.conrelid
    JOIN pg_namespace nsp ON nsp.oid = rel.relnamespace
    JOIN pg_class parent ON parent.oid = c.confrelid
    JOIN pg_namespace parent_nsp ON parent_nsp.oid = parent.relnamespace
    JOIN pg_attribute child_col
      ON child_col.attrelid = c.conrelid
     AND child_col.attnum = c.conkey[1]
    JOIN pg_attribute parent_col
      ON parent_col.attrelid = c.confrelid
     AND parent_col.attnum = c.confkey[1]
    WHERE c.contype = 'f'
      AND nsp.nspname = 'public'
      AND rel.relname = 'grade_change_audit'
      AND c.conname = 'grade_change_audit_grade_entry_id_fkey'
      AND parent_nsp.nspname = 'public'
      AND parent.relname = 'grade_entries'
      AND cardinality(c.conkey) = 1
      AND cardinality(c.confkey) = 1
      AND child_col.attname = 'grade_entry_id'
      AND parent_col.attname = 'id'
      AND c.confdeltype = 'r'
  ) INTO v_expected;

  IF v_fk_count <> 1 OR NOT v_expected THEN
    FOR r IN
      SELECT DISTINCT c.conname
      FROM pg_constraint c
      JOIN pg_class rel ON rel.oid = c.conrelid
      JOIN pg_namespace nsp ON nsp.oid = rel.relnamespace
      JOIN pg_attribute child_col
        ON child_col.attrelid = c.conrelid
       AND child_col.attnum = ANY (c.conkey)
      WHERE c.contype = 'f'
        AND nsp.nspname = 'public'
        AND rel.relname = 'grade_change_audit'
        AND child_col.attname = 'grade_entry_id'
    LOOP
      EXECUTE format(
        'ALTER TABLE grade_change_audit DROP CONSTRAINT %I',
        r.conname
      );
    END LOOP;

    ALTER TABLE grade_change_audit
      ADD CONSTRAINT grade_change_audit_grade_entry_id_fkey
      FOREIGN KEY (grade_entry_id) REFERENCES grade_entries(id)
      ON DELETE RESTRICT
      NOT VALID;
  END IF;
END $$;

ALTER TABLE grade_change_audit
  VALIDATE CONSTRAINT grade_change_audit_grade_entry_id_fkey;
ALTER TABLE enrollment_history
  VALIDATE CONSTRAINT enrollment_history_enrollment_id_fkey;

-- Fail closed unless each audited reference has exactly one canonical,
-- validated, single-column ON DELETE RESTRICT FK.
DO $$
DECLARE
  v_grade_count INTEGER;
  v_enrollment_count INTEGER;
BEGIN
  SELECT COUNT(*)
  INTO v_grade_count
  FROM pg_constraint c
  JOIN pg_class rel ON rel.oid = c.conrelid
  JOIN pg_namespace nsp ON nsp.oid = rel.relnamespace
  JOIN pg_class parent ON parent.oid = c.confrelid
  JOIN pg_namespace parent_nsp ON parent_nsp.oid = parent.relnamespace
  JOIN pg_attribute child_col
    ON child_col.attrelid = c.conrelid
   AND child_col.attnum = c.conkey[1]
  JOIN pg_attribute parent_col
    ON parent_col.attrelid = c.confrelid
   AND parent_col.attnum = c.confkey[1]
  WHERE c.contype = 'f'
    AND nsp.nspname = 'public'
    AND rel.relname = 'grade_change_audit'
    AND c.conname = 'grade_change_audit_grade_entry_id_fkey'
    AND parent_nsp.nspname = 'public'
    AND parent.relname = 'grade_entries'
    AND cardinality(c.conkey) = 1
    AND cardinality(c.confkey) = 1
    AND child_col.attname = 'grade_entry_id'
    AND parent_col.attname = 'id'
    AND c.confdeltype = 'r'
    AND c.convalidated;

  SELECT COUNT(*)
  INTO v_enrollment_count
  FROM pg_constraint c
  JOIN pg_class rel ON rel.oid = c.conrelid
  JOIN pg_namespace nsp ON nsp.oid = rel.relnamespace
  JOIN pg_class parent ON parent.oid = c.confrelid
  JOIN pg_namespace parent_nsp ON parent_nsp.oid = parent.relnamespace
  JOIN pg_attribute child_col
    ON child_col.attrelid = c.conrelid
   AND child_col.attnum = c.conkey[1]
  JOIN pg_attribute parent_col
    ON parent_col.attrelid = c.confrelid
   AND parent_col.attnum = c.confkey[1]
  WHERE c.contype = 'f'
    AND nsp.nspname = 'public'
    AND rel.relname = 'enrollment_history'
    AND c.conname = 'enrollment_history_enrollment_id_fkey'
    AND parent_nsp.nspname = 'public'
    AND parent.relname = 'enrollments'
    AND cardinality(c.conkey) = 1
    AND cardinality(c.confkey) = 1
    AND child_col.attname = 'enrollment_id'
    AND parent_col.attname = 'id'
    AND c.confdeltype = 'r'
    AND c.convalidated;

  IF v_grade_count <> 1 THEN
    RAISE EXCEPTION
      'W1-DATA-14: canonical validated grade_change_audit FK count is %, expected 1',
      v_grade_count;
  END IF;
  IF v_enrollment_count <> 1 THEN
    RAISE EXCEPTION
      'W1-DATA-14: canonical validated enrollment_history FK count is %, expected 1',
      v_enrollment_count;
  END IF;

  IF (
    SELECT COUNT(*)
    FROM pg_constraint c
    JOIN pg_class rel ON rel.oid = c.conrelid
    JOIN pg_namespace nsp ON nsp.oid = rel.relnamespace
    JOIN pg_attribute child_col
      ON child_col.attrelid = c.conrelid
     AND child_col.attnum = ANY (c.conkey)
    WHERE c.contype = 'f'
      AND nsp.nspname = 'public'
      AND rel.relname = 'grade_change_audit'
      AND child_col.attname = 'grade_entry_id'
  ) <> 1 THEN
    RAISE EXCEPTION 'W1-DATA-14: grade_change_audit has duplicate grade_entry_id FKs';
  END IF;

  IF (
    SELECT COUNT(*)
    FROM pg_constraint c
    JOIN pg_class rel ON rel.oid = c.conrelid
    JOIN pg_namespace nsp ON nsp.oid = rel.relnamespace
    JOIN pg_attribute child_col
      ON child_col.attrelid = c.conrelid
     AND child_col.attnum = ANY (c.conkey)
    WHERE c.contype = 'f'
      AND nsp.nspname = 'public'
      AND rel.relname = 'enrollment_history'
      AND child_col.attname = 'enrollment_id'
  ) <> 1 THEN
    RAISE EXCEPTION 'W1-DATA-14: enrollment_history has duplicate enrollment_id FKs';
  END IF;
END $$;

-- Trigger functions execute as their table-owning definer, so the application
-- role needs SELECT only. Removing direct INSERT makes a second application
-- audit row impossible while parent DML continues to produce one trigger row.
REVOKE ALL ON enrollment_history, grade_change_audit FROM PUBLIC;
DO $$
BEGIN
  IF EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'proctira_app') THEN
    REVOKE ALL ON enrollment_history, grade_change_audit FROM proctira_app;
    GRANT SELECT ON enrollment_history, grade_change_audit TO proctira_app;
    REVOKE ALL ON grade_change_audit_orphan_quarantine FROM proctira_app;
  END IF;
END $$;

INSERT INTO schema_migrations (filename)
VALUES ('096_w1_data_14_audit_fk_integrity.sql')
ON CONFLICT (filename) DO NOTHING;
