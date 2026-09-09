-- Scholarships domain (G-204): programs, applications, disbursements, compliance.
-- Raw SQL — no Prisma. Applied after 015 via tools/scripts/apply-sql.sh.
--
-- RLS policies are included here (tables created after 015).

CREATE TABLE IF NOT EXISTS scholarship_programs (
  id UUID PRIMARY KEY,
  tenant_id UUID NOT NULL,
  name TEXT NOT NULL,
  description TEXT,
  application_start_date DATE NOT NULL,
  application_end_date DATE NOT NULL,
  total_slots INTEGER NOT NULL CHECK (total_slots >= 1),
  used_slots INTEGER NOT NULL DEFAULT 0 CHECK (used_slots >= 0),
  amount_per_recipient NUMERIC NOT NULL CHECK (amount_per_recipient >= 0),
  currency TEXT NOT NULL DEFAULT 'USD',
  disbursement_frequency TEXT NOT NULL DEFAULT 'one_time'
    CHECK (disbursement_frequency IN ('one_time', 'monthly', 'quarterly', 'semester', 'annual')),
  eligibility JSONB NOT NULL DEFAULT '{}'::jsonb,
  status TEXT NOT NULL DEFAULT 'draft'
    CHECK (status IN ('draft', 'open', 'closed', 'archived')),
  academic_period_id UUID,
  funding_source_id UUID,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_scholarship_programs_tenant_status
  ON scholarship_programs (tenant_id, status);

CREATE TABLE IF NOT EXISTS scholarship_applications (
  id UUID PRIMARY KEY,
  tenant_id UUID NOT NULL,
  program_id UUID NOT NULL REFERENCES scholarship_programs(id) ON DELETE CASCADE,
  applicant_id UUID NOT NULL,
  institution_id UUID NOT NULL,
  status TEXT NOT NULL DEFAULT 'draft'
    CHECK (status IN ('draft', 'submitted', 'under_review', 'approved', 'rejected', 'withdrawn')),
  academic_records JSONB NOT NULL DEFAULT '[]'::jsonb,
  financial_info JSONB NOT NULL DEFAULT '{}'::jsonb,
  documents JSONB NOT NULL DEFAULT '[]'::jsonb,
  personal_statement TEXT,
  area_id UUID,
  gender TEXT,
  workflow_instance_id UUID,
  submitted_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  reviewed_at TIMESTAMPTZ,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

-- G-911: who decided and why (idempotent so ensureScholarshipSchema can re-run).
ALTER TABLE scholarship_applications ADD COLUMN IF NOT EXISTS reviewer_id TEXT;
ALTER TABLE scholarship_applications ADD COLUMN IF NOT EXISTS review_notes TEXT;

CREATE INDEX IF NOT EXISTS idx_scholarship_applications_tenant_program
  ON scholarship_applications (tenant_id, program_id);

CREATE INDEX IF NOT EXISTS idx_scholarship_applications_tenant_status
  ON scholarship_applications (tenant_id, status);

CREATE TABLE IF NOT EXISTS scholarship_disbursements (
  id UUID PRIMARY KEY,
  tenant_id UUID NOT NULL,
  application_id UUID NOT NULL REFERENCES scholarship_applications(id) ON DELETE CASCADE,
  amount NUMERIC NOT NULL CHECK (amount >= 0),
  scheduled_date DATE NOT NULL,
  paid_date DATE,
  payment_status TEXT NOT NULL DEFAULT 'scheduled'
    CHECK (payment_status IN ('scheduled', 'processing', 'paid', 'failed', 'cancelled')),
  payment_method TEXT
    CHECK (payment_method IS NULL OR payment_method IN ('bank_transfer', 'check', 'cash', 'mobile_money')),
  transaction_reference TEXT,
  notes TEXT,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_scholarship_disbursements_tenant_app
  ON scholarship_disbursements (tenant_id, application_id);

CREATE TABLE IF NOT EXISTS scholarship_compliance_records (
  id UUID PRIMARY KEY,
  tenant_id UUID NOT NULL,
  application_id UUID NOT NULL REFERENCES scholarship_applications(id) ON DELETE CASCADE,
  compliance_type TEXT NOT NULL
    CHECK (compliance_type IN (
      'academic_performance', 'attendance', 'community_service', 'report_submission'
    )),
  status TEXT NOT NULL
    CHECK (status IN ('compliant', 'non_compliant', 'pending_review')),
  evaluation_date DATE NOT NULL,
  details TEXT,
  evaluator_id UUID,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_scholarship_compliance_tenant_app
  ON scholarship_compliance_records (tenant_id, application_id);

-- ========================= RLS (G-103 / G-204) =========================
ALTER TABLE scholarship_programs ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS tenant_isolation ON scholarship_programs;
CREATE POLICY tenant_isolation ON scholarship_programs
  FOR ALL
  USING (tenant_id::text = NULLIF(current_setting('app.tenant_id', true), ''))
  WITH CHECK (tenant_id::text = NULLIF(current_setting('app.tenant_id', true), ''));

ALTER TABLE scholarship_applications ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS tenant_isolation ON scholarship_applications;
CREATE POLICY tenant_isolation ON scholarship_applications
  FOR ALL
  USING (tenant_id::text = NULLIF(current_setting('app.tenant_id', true), ''))
  WITH CHECK (tenant_id::text = NULLIF(current_setting('app.tenant_id', true), ''));

ALTER TABLE scholarship_disbursements ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS tenant_isolation ON scholarship_disbursements;
CREATE POLICY tenant_isolation ON scholarship_disbursements
  FOR ALL
  USING (tenant_id::text = NULLIF(current_setting('app.tenant_id', true), ''))
  WITH CHECK (tenant_id::text = NULLIF(current_setting('app.tenant_id', true), ''));

ALTER TABLE scholarship_compliance_records ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS tenant_isolation ON scholarship_compliance_records;
CREATE POLICY tenant_isolation ON scholarship_compliance_records
  FOR ALL
  USING (tenant_id::text = NULLIF(current_setting('app.tenant_id', true), ''))
  WITH CHECK (tenant_id::text = NULLIF(current_setting('app.tenant_id', true), ''));
