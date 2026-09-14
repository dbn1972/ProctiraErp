-- W1-SEC-03 COMPLETE: effective-dated court / custody restriction orders.
-- Closes residual from 054 (household/custody graph without restrictions;
-- service previously fail-opened when custody rows were absent).
--
-- Invariants (enforced in ParentPortalService + this schema):
--   1. Active custody must be effective-dated (effective_from / effective_to).
--   2. Missing custody data ⇒ deny guardian access (fail closed).
--   3. Governed ops (medical / fees) require authority flags AND no active
--      restriction that blocks that authority.
--
-- Also backfills RLS on 054 guardian_* tables (were created without policies).

-- ---------------------------------------------------------------------------
-- Effective-dating guard on existing custody rows
-- ---------------------------------------------------------------------------
DO $$
BEGIN
  IF to_regclass('public.guardian_student_custody') IS NULL THEN
    RETURN;
  END IF;

  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint WHERE conname = 'guardian_student_custody_effective_range_chk'
  ) THEN
    ALTER TABLE guardian_student_custody
      ADD CONSTRAINT guardian_student_custody_effective_range_chk
      CHECK (effective_to IS NULL OR effective_to > effective_from);
  END IF;

  CREATE INDEX IF NOT EXISTS idx_guardian_student_custody_effective
    ON guardian_student_custody (tenant_id, student_id, effective_from, effective_to)
    WHERE status = 'active' AND custody_type <> 'none';
END $$;

-- ---------------------------------------------------------------------------
-- Court / restriction orders
-- ---------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS guardian_custody_restrictions (
  id UUID PRIMARY KEY,
  tenant_id UUID NOT NULL,
  student_id UUID NOT NULL,
  -- Guardian subject of the restriction (court / protective order).
  parent_user_id TEXT NOT NULL,
  -- Optional household scope; when set, only applies while the guardian is
  -- a member of that household.
  household_id UUID REFERENCES guardian_households(id) ON DELETE SET NULL,
  restriction_kind TEXT NOT NULL DEFAULT 'court_order'
    CHECK (restriction_kind IN ('court_order', 'protective_order', 'school_admin', 'other')),
  -- Governed authorities suspended while the restriction is effective.
  blocks_medical BOOLEAN NOT NULL DEFAULT true,
  blocks_fees BOOLEAN NOT NULL DEFAULT true,
  -- When true, all guardian access (messaging / academics / lists) is denied.
  blocks_all_access BOOLEAN NOT NULL DEFAULT false,
  status TEXT NOT NULL DEFAULT 'active'
    CHECK (status IN ('active', 'lifted')),
  effective_from TIMESTAMPTZ NOT NULL DEFAULT now(),
  effective_to TIMESTAMPTZ,
  court_order_ref TEXT NOT NULL DEFAULT '',
  notes TEXT NOT NULL DEFAULT '',
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  CONSTRAINT guardian_custody_restrictions_effective_range_chk
    CHECK (effective_to IS NULL OR effective_to > effective_from)
);

CREATE INDEX IF NOT EXISTS idx_guardian_custody_restrictions_parent
  ON guardian_custody_restrictions (tenant_id, parent_user_id, student_id)
  WHERE status = 'active';

CREATE INDEX IF NOT EXISTS idx_guardian_custody_restrictions_student_effective
  ON guardian_custody_restrictions (tenant_id, student_id, effective_from, effective_to)
  WHERE status = 'active';

COMMENT ON TABLE guardian_custody_restrictions IS
  'W1-SEC-03: effective-dated court/protective restriction orders against a guardian for a student.';
COMMENT ON COLUMN guardian_custody_restrictions.blocks_medical IS
  'When true, can_consent_medical authority is suspended for the effective window.';
COMMENT ON COLUMN guardian_custody_restrictions.blocks_fees IS
  'When true, can_view_fees authority is suspended for the effective window.';
COMMENT ON COLUMN guardian_custody_restrictions.blocks_all_access IS
  'When true, guardian has no portal access to the student while effective.';

-- Optional student FK when students table exists (NOT VALID — same posture as 071).
DO $$
BEGIN
  IF to_regclass('public.students') IS NULL THEN
    RETURN;
  END IF;
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint WHERE conname = 'guardian_custody_restrictions_student_id_fkey'
  ) THEN
    ALTER TABLE guardian_custody_restrictions
      ADD CONSTRAINT guardian_custody_restrictions_student_id_fkey
      FOREIGN KEY (student_id) REFERENCES students(id) NOT VALID;
  END IF;
END $$;

-- ---------------------------------------------------------------------------
-- RLS — new restrictions + backfill for 054 guardian tables
-- ---------------------------------------------------------------------------
DO $$
DECLARE
  t TEXT;
BEGIN
  FOREACH t IN ARRAY ARRAY[
    'guardian_households',
    'guardian_household_members',
    'guardian_student_custody',
    'guardian_custody_restrictions'
  ]
  LOOP
    IF to_regclass(format('public.%I', t)) IS NULL THEN
      CONTINUE;
    END IF;

    EXECUTE format('ALTER TABLE %I ENABLE ROW LEVEL SECURITY', t);
    EXECUTE format('ALTER TABLE %I FORCE ROW LEVEL SECURITY', t);
    EXECUTE format('DROP POLICY IF EXISTS tenant_isolation ON %I', t);

    -- Prefer app_tenant_id() when 071 is applied; fall back to GUC read.
    IF EXISTS (
      SELECT 1 FROM pg_proc p
      JOIN pg_namespace n ON n.oid = p.pronamespace
      WHERE n.nspname = 'public' AND p.proname = 'app_tenant_id'
    ) THEN
      EXECUTE format(
        'CREATE POLICY tenant_isolation ON %I FOR ALL
           USING (tenant_id::text = NULLIF(app_tenant_id(), ''''))
           WITH CHECK (tenant_id::text = NULLIF(app_tenant_id(), ''''))',
        t
      );
    ELSE
      EXECUTE format(
        'CREATE POLICY tenant_isolation ON %I FOR ALL
           USING (tenant_id::text = NULLIF(current_setting(''app.tenant_id'', true), ''''))
           WITH CHECK (tenant_id::text = NULLIF(current_setting(''app.tenant_id'', true), ''''))',
        t
      );
    END IF;
  END LOOP;
END $$;
