-- Health special-needs persistence (G-203).
-- Extends the health domain beyond 012 profile/screening PHI.
-- Sensitive text columns may hold AES-GCM ciphertext (enc:v1:...) when
-- PHI_ENCRYPTION_KEY is configured; searchable keys stay plaintext.

CREATE TABLE IF NOT EXISTS health_special_needs_assessments (
  id UUID PRIMARY KEY,
  tenant_id TEXT NOT NULL,
  student_id TEXT NOT NULL,
  assessment_date DATE NOT NULL,
  assessor_name TEXT NOT NULL,
  assessor_role TEXT NOT NULL,
  assessment_type TEXT NOT NULL,
  findings TEXT NOT NULL,
  recommendations TEXT,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_health_sn_assessments_tenant_student
  ON health_special_needs_assessments (tenant_id, student_id);

CREATE TABLE IF NOT EXISTS health_diagnoses (
  id UUID PRIMARY KEY,
  tenant_id TEXT NOT NULL,
  student_id TEXT NOT NULL,
  assessment_id UUID,
  diagnosis_date DATE NOT NULL,
  diagnosed_by TEXT NOT NULL,
  condition TEXT NOT NULL,
  category TEXT NOT NULL,
  severity TEXT NOT NULL,
  notes TEXT,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_health_diagnoses_tenant_student
  ON health_diagnoses (tenant_id, student_id);

CREATE TABLE IF NOT EXISTS health_referrals (
  id UUID PRIMARY KEY,
  tenant_id TEXT NOT NULL,
  student_id TEXT NOT NULL,
  diagnosis_id UUID,
  referral_date DATE NOT NULL,
  referred_by TEXT NOT NULL,
  referred_to TEXT NOT NULL,
  reason TEXT NOT NULL,
  status TEXT NOT NULL,
  appointment_date DATE,
  outcome TEXT,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_health_referrals_tenant_student
  ON health_referrals (tenant_id, student_id);

CREATE TABLE IF NOT EXISTS health_accommodation_plans (
  id UUID PRIMARY KEY,
  tenant_id TEXT NOT NULL,
  student_id TEXT NOT NULL,
  diagnosis_id UUID,
  plan_name TEXT NOT NULL,
  start_date DATE NOT NULL,
  end_date DATE,
  accommodations JSONB NOT NULL DEFAULT '[]'::jsonb,
  review_date DATE,
  status TEXT NOT NULL,
  notes TEXT,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_health_accommodation_plans_tenant_student
  ON health_accommodation_plans (tenant_id, student_id);

-- PHI read-access log (metadata only — never store PHI payloads).
CREATE TABLE IF NOT EXISTS health_phi_access_log (
  id UUID PRIMARY KEY,
  tenant_id TEXT NOT NULL,
  actor_user_id TEXT NOT NULL,
  student_id TEXT NOT NULL,
  resource_type TEXT NOT NULL,
  resource_id TEXT,
  action TEXT NOT NULL DEFAULT 'READ',
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_health_phi_access_log_tenant_student
  ON health_phi_access_log (tenant_id, student_id, created_at DESC);

-- ========================= RLS (G-103 / G-203) =========================
ALTER TABLE health_special_needs_assessments ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS tenant_isolation ON health_special_needs_assessments;
CREATE POLICY tenant_isolation ON health_special_needs_assessments
  FOR ALL
  USING (tenant_id::text = NULLIF(current_setting('app.tenant_id', true), ''))
  WITH CHECK (tenant_id::text = NULLIF(current_setting('app.tenant_id', true), ''));

ALTER TABLE health_diagnoses ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS tenant_isolation ON health_diagnoses;
CREATE POLICY tenant_isolation ON health_diagnoses
  FOR ALL
  USING (tenant_id::text = NULLIF(current_setting('app.tenant_id', true), ''))
  WITH CHECK (tenant_id::text = NULLIF(current_setting('app.tenant_id', true), ''));

ALTER TABLE health_referrals ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS tenant_isolation ON health_referrals;
CREATE POLICY tenant_isolation ON health_referrals
  FOR ALL
  USING (tenant_id::text = NULLIF(current_setting('app.tenant_id', true), ''))
  WITH CHECK (tenant_id::text = NULLIF(current_setting('app.tenant_id', true), ''));

ALTER TABLE health_accommodation_plans ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS tenant_isolation ON health_accommodation_plans;
CREATE POLICY tenant_isolation ON health_accommodation_plans
  FOR ALL
  USING (tenant_id::text = NULLIF(current_setting('app.tenant_id', true), ''))
  WITH CHECK (tenant_id::text = NULLIF(current_setting('app.tenant_id', true), ''));

ALTER TABLE health_phi_access_log ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS tenant_isolation ON health_phi_access_log;
CREATE POLICY tenant_isolation ON health_phi_access_log
  FOR ALL
  USING (tenant_id::text = NULLIF(current_setting('app.tenant_id', true), ''))
  WITH CHECK (tenant_id::text = NULLIF(current_setting('app.tenant_id', true), ''));
