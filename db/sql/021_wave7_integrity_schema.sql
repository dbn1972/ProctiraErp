-- Wave 7 (G-701 / G-710 / G-718 / G-732) — integrity + tenancy hardening.
--
-- Idempotent. Apply after 001–020 via tools/scripts/apply-sql.sh.
--
--   1. schema_migrations ledger (one row per applied db/sql file)
--   2. set_updated_at() trigger on every table that has updated_at
--   3. enrollment_history + transfer_records (G-701 SIS enrollment lifecycle)
--   4. FORCE ROW LEVEL SECURITY on every RLS-enabled table (owner cannot bypass)
--   5. RLS for the four tables that lacked it (tenants, insights_ui_*)
--   6. Missing tenant_id indexes (bell_periods, grading_scale_bands, parent_*)
--
-- Tenant FK constraints are in 021b_tenant_fk_constraints.sql (opt-in via
-- APPLY_STRICT_FKS=1) because unit/integration fixtures create rows with ad-hoc
-- tenant ids that are not present in `tenants`.

CREATE EXTENSION IF NOT EXISTS "uuid-ossp";

-- ---------------------------------------------------------------------------
-- 1. Migration ledger
-- ---------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS schema_migrations (
  filename    TEXT PRIMARY KEY,
  checksum    TEXT,
  applied_at  TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  applied_by  TEXT NOT NULL DEFAULT current_user
);

-- ---------------------------------------------------------------------------
-- 2. updated_at trigger
-- ---------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION set_updated_at()
RETURNS TRIGGER AS $$
BEGIN
  NEW.updated_at = NOW();
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

DO $$
DECLARE
  t RECORD;
BEGIN
  FOR t IN
    SELECT c.table_name
    FROM information_schema.columns c
    JOIN information_schema.tables tb
      ON tb.table_schema = c.table_schema AND tb.table_name = c.table_name
    WHERE c.table_schema = 'public'
      AND c.column_name = 'updated_at'
      AND tb.table_type = 'BASE TABLE'
  LOOP
    EXECUTE format('DROP TRIGGER IF EXISTS trg_set_updated_at ON %I', t.table_name);
    EXECUTE format(
      'CREATE TRIGGER trg_set_updated_at BEFORE UPDATE ON %I
         FOR EACH ROW EXECUTE FUNCTION set_updated_at()',
      t.table_name
    );
  END LOOP;
END $$;

-- ---------------------------------------------------------------------------
-- 3. Enrollment lifecycle (G-701)
-- ---------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS enrollment_history (
  id                 UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  tenant_id          UUID NOT NULL,
  enrollment_id      UUID NOT NULL REFERENCES enrollments(id) ON DELETE CASCADE,
  previous_status    TEXT,
  new_status         TEXT NOT NULL,
  effective_date     DATE NOT NULL DEFAULT CURRENT_DATE,
  institution_id     UUID NOT NULL,
  academic_period_id UUID NOT NULL,
  reason             TEXT,
  created_at         TIMESTAMPTZ NOT NULL DEFAULT NOW()
);
CREATE INDEX IF NOT EXISTS enrollment_history_tenant_enrollment_idx
  ON enrollment_history (tenant_id, enrollment_id, created_at DESC);

CREATE TABLE IF NOT EXISTS transfer_records (
  id                         UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  tenant_id                  UUID NOT NULL,
  student_id                 UUID NOT NULL,
  source_institution_id      UUID NOT NULL,
  source_enrollment_id       UUID NOT NULL,
  destination_institution_id UUID NOT NULL,
  destination_enrollment_id  UUID NOT NULL,
  transfer_date              DATE NOT NULL DEFAULT CURRENT_DATE,
  reason                     TEXT NOT NULL,
  created_at                 TIMESTAMPTZ NOT NULL DEFAULT NOW()
);
CREATE INDEX IF NOT EXISTS transfer_records_tenant_student_idx
  ON transfer_records (tenant_id, student_id, created_at DESC);

ALTER TABLE enrollment_history ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS tenant_isolation ON enrollment_history;
CREATE POLICY tenant_isolation ON enrollment_history FOR ALL
  USING (tenant_id::text = NULLIF(current_setting('app.tenant_id', true), ''))
  WITH CHECK (tenant_id::text = NULLIF(current_setting('app.tenant_id', true), ''));

ALTER TABLE transfer_records ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS tenant_isolation ON transfer_records;
CREATE POLICY tenant_isolation ON transfer_records FOR ALL
  USING (tenant_id::text = NULLIF(current_setting('app.tenant_id', true), ''))
  WITH CHECK (tenant_id::text = NULLIF(current_setting('app.tenant_id', true), ''));

-- Core onboarding tables (001) carry tenant_id but had no RLS.
DO $$
DECLARE
  t TEXT;
BEGIN
  FOREACH t IN ARRAY ARRAY[
    'boards', 'institutions', 'academic_periods', 'grades', 'students', 'staff', 'enrollments'
  ]
  LOOP
    IF to_regclass(t) IS NOT NULL THEN
      EXECUTE format('ALTER TABLE %I ENABLE ROW LEVEL SECURITY', t);
      EXECUTE format('DROP POLICY IF EXISTS tenant_isolation ON %I', t);
      EXECUTE format(
        'CREATE POLICY tenant_isolation ON %I FOR ALL
           USING (tenant_id::text = NULLIF(current_setting(''app.tenant_id'', true), '''')
                  OR current_setting(''app.platform_admin'', true) = ''1'')
           WITH CHECK (tenant_id::text = NULLIF(current_setting(''app.tenant_id'', true), '''')
                  OR current_setting(''app.platform_admin'', true) = ''1'')',
        t
      );
    END IF;
  END LOOP;
END $$;

-- ---------------------------------------------------------------------------
-- 5. RLS for previously uncovered tables
-- ---------------------------------------------------------------------------
-- tenants: a tenant may read/update only itself; the platform control plane
-- binds app.platform_admin = '1' to manage all tenants.
ALTER TABLE tenants ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS tenant_isolation ON tenants;
CREATE POLICY tenant_isolation ON tenants FOR ALL
  USING (id::text = NULLIF(current_setting('app.tenant_id', true), '')
         OR current_setting('app.platform_admin', true) = '1')
  WITH CHECK (id::text = NULLIF(current_setting('app.tenant_id', true), '')
         OR current_setting('app.platform_admin', true) = '1');

DO $$
DECLARE
  t TEXT;
BEGIN
  -- insights_ui_templates / indicators / geo_features are platform reference
  -- data without tenant_id; only the per-tenant runs / import jobs get RLS.
  FOREACH t IN ARRAY ARRAY[
    'insights_ui_runs', 'insights_ui_import_jobs'
  ]
  LOOP
    IF to_regclass(t) IS NOT NULL AND EXISTS (
      SELECT 1 FROM information_schema.columns
      WHERE table_schema = 'public' AND table_name = t AND column_name = 'tenant_id'
    ) THEN
      EXECUTE format('ALTER TABLE %I ENABLE ROW LEVEL SECURITY', t);
      EXECUTE format('DROP POLICY IF EXISTS tenant_isolation ON %I', t);
      EXECUTE format(
        'CREATE POLICY tenant_isolation ON %I FOR ALL
           USING (tenant_id::text = NULLIF(current_setting(''app.tenant_id'', true), ''''))
           WITH CHECK (tenant_id::text = NULLIF(current_setting(''app.tenant_id'', true), ''''))',
        t
      );
    END IF;
  END LOOP;
END $$;

-- ---------------------------------------------------------------------------
-- 4. FORCE RLS on every RLS-enabled table so the owning role cannot bypass
-- ---------------------------------------------------------------------------
DO $$
DECLARE
  t RECORD;
BEGIN
  FOR t IN
    SELECT tablename FROM pg_tables
    WHERE schemaname = 'public' AND rowsecurity = true
  LOOP
    EXECUTE format('ALTER TABLE %I FORCE ROW LEVEL SECURITY', t.tablename);
  END LOOP;
END $$;

-- ---------------------------------------------------------------------------
-- 6. Missing tenant_id indexes (G-732)
-- ---------------------------------------------------------------------------
DO $$
DECLARE
  t TEXT;
BEGIN
  FOREACH t IN ARRAY ARRAY[
    'bell_periods', 'grading_scale_bands', 'parent_fee_payments', 'parent_messages'
  ]
  LOOP
    IF to_regclass(t) IS NOT NULL THEN
      EXECUTE format('CREATE INDEX IF NOT EXISTS %I ON %I (tenant_id)', t || '_tenant_idx', t);
    END IF;
  END LOOP;
END $$;

INSERT INTO schema_migrations (filename)
VALUES ('021_wave7_integrity_schema.sql')
ON CONFLICT (filename) DO NOTHING;
