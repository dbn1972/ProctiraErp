-- Admissions CRM depth (Wave 9 / G-906): enquiry pipeline, seat matrix,
-- merit lists, and offer/enrol records. Applied after 014 via apply-sql.sh.
-- Raw SQL — RLS via withPgTenant / app.tenant_id (same shape as 030).

ALTER TABLE admission_applications
  ADD COLUMN IF NOT EXISTS enquiry_id UUID;
ALTER TABLE admission_applications
  ADD COLUMN IF NOT EXISTS academic_period_id UUID;
ALTER TABLE admission_applications
  ADD COLUMN IF NOT EXISTS grade_id UUID;
ALTER TABLE admission_applications
  ADD COLUMN IF NOT EXISTS quota TEXT NOT NULL DEFAULT 'general';
ALTER TABLE admission_applications
  ADD COLUMN IF NOT EXISTS interview_score NUMERIC(8, 2);
ALTER TABLE admission_applications
  ADD COLUMN IF NOT EXISTS test_score NUMERIC(8, 2);

CREATE INDEX IF NOT EXISTS admission_applications_placement_idx
  ON admission_applications (tenant_id, institution_id, academic_period_id, grade_id, quota);

CREATE TABLE IF NOT EXISTS admission_enquiries (
  id UUID PRIMARY KEY,
  tenant_id UUID NOT NULL,
  institution_id UUID NOT NULL,
  academic_period_id UUID NOT NULL,
  grade_id UUID NOT NULL,
  quota TEXT NOT NULL DEFAULT 'general',
  source TEXT NOT NULL DEFAULT 'other'
    CHECK (source IN ('website', 'walk_in', 'referral', 'campaign', 'other')),
  stage TEXT NOT NULL DEFAULT 'new'
    CHECK (stage IN ('new', 'contacted', 'qualified', 'applied', 'lost', 'waitlisted')),
  first_name TEXT NOT NULL,
  last_name TEXT NOT NULL,
  date_of_birth DATE NOT NULL,
  gender TEXT NOT NULL DEFAULT 'other',
  guardian_name TEXT NOT NULL,
  guardian_phone TEXT NOT NULL,
  guardian_email TEXT,
  interview_score NUMERIC(8, 2),
  test_score NUMERIC(8, 2),
  application_id UUID REFERENCES admission_applications(id) ON DELETE SET NULL,
  notes TEXT,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS admission_enquiries_tenant_stage_idx
  ON admission_enquiries (tenant_id, stage, created_at DESC);

CREATE TABLE IF NOT EXISTS enquiry_followups (
  id UUID PRIMARY KEY,
  tenant_id UUID NOT NULL,
  enquiry_id UUID NOT NULL REFERENCES admission_enquiries(id) ON DELETE CASCADE,
  due_at TIMESTAMPTZ NOT NULL,
  owner_id TEXT,
  notes TEXT NOT NULL DEFAULT '',
  status TEXT NOT NULL DEFAULT 'open'
    CHECK (status IN ('open', 'done', 'cancelled')),
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS enquiry_followups_enquiry_idx
  ON enquiry_followups (tenant_id, enquiry_id, due_at);

CREATE TABLE IF NOT EXISTS seat_matrix (
  id UUID PRIMARY KEY,
  tenant_id UUID NOT NULL,
  institution_id UUID NOT NULL,
  academic_period_id UUID NOT NULL,
  grade_id UUID NOT NULL,
  quota TEXT NOT NULL DEFAULT 'general',
  seats INTEGER NOT NULL CHECK (seats >= 0),
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  UNIQUE (tenant_id, institution_id, academic_period_id, grade_id, quota)
);
CREATE INDEX IF NOT EXISTS seat_matrix_lookup_idx
  ON seat_matrix (tenant_id, institution_id, academic_period_id, grade_id);

CREATE TABLE IF NOT EXISTS merit_lists (
  id UUID PRIMARY KEY,
  tenant_id UUID NOT NULL,
  institution_id UUID NOT NULL,
  academic_period_id UUID NOT NULL,
  grade_id UUID NOT NULL,
  interview_weight NUMERIC(8, 4) NOT NULL,
  test_weight NUMERIC(8, 4) NOT NULL,
  weights_snapshot JSONB NOT NULL,
  generated_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  UNIQUE (tenant_id, institution_id, academic_period_id, grade_id)
);
CREATE INDEX IF NOT EXISTS merit_lists_lookup_idx
  ON merit_lists (tenant_id, institution_id, academic_period_id, grade_id);

CREATE TABLE IF NOT EXISTS merit_list_entries (
  id UUID PRIMARY KEY,
  tenant_id UUID NOT NULL,
  merit_list_id UUID NOT NULL REFERENCES merit_lists(id) ON DELETE CASCADE,
  application_id UUID NOT NULL REFERENCES admission_applications(id) ON DELETE CASCADE,
  rank INTEGER NOT NULL CHECK (rank >= 1),
  score NUMERIC(12, 4) NOT NULL,
  interview_score NUMERIC(8, 2) NOT NULL DEFAULT 0,
  test_score NUMERIC(8, 2) NOT NULL DEFAULT 0,
  weights_snapshot JSONB NOT NULL,
  UNIQUE (merit_list_id, application_id),
  UNIQUE (merit_list_id, rank)
);
CREATE INDEX IF NOT EXISTS merit_list_entries_list_idx
  ON merit_list_entries (tenant_id, merit_list_id, rank);

CREATE TABLE IF NOT EXISTS admission_offers (
  id UUID PRIMARY KEY,
  tenant_id UUID NOT NULL,
  application_id UUID NOT NULL REFERENCES admission_applications(id) ON DELETE CASCADE,
  merit_list_id UUID REFERENCES merit_lists(id) ON DELETE SET NULL,
  institution_id UUID NOT NULL,
  academic_period_id UUID NOT NULL,
  grade_id UUID NOT NULL,
  quota TEXT NOT NULL DEFAULT 'general',
  status TEXT NOT NULL DEFAULT 'draft'
    CHECK (status IN ('draft', 'sent', 'accepted', 'declined', 'expired')),
  fee_amount NUMERIC(12, 2) NOT NULL DEFAULT 0,
  fee_currency TEXT NOT NULL DEFAULT 'INR',
  payment_ref TEXT,
  offer_fee_invoice_id UUID,
  enrolled_student_id UUID,
  expires_at TIMESTAMPTZ,
  offer_document JSONB NOT NULL DEFAULT '{}'::jsonb,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS admission_offers_application_idx
  ON admission_offers (tenant_id, application_id, status);
CREATE INDEX IF NOT EXISTS admission_offers_seat_idx
  ON admission_offers (tenant_id, institution_id, academic_period_id, grade_id, quota, status);

-- ---------------------------------------------------------------------------
-- RLS (same policy shape as 030; tenant bound via withPgTenant / app.tenant_id)
-- ---------------------------------------------------------------------------
ALTER TABLE admission_enquiries ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS tenant_isolation ON admission_enquiries;
CREATE POLICY tenant_isolation ON admission_enquiries
  FOR ALL
  USING (tenant_id::text = NULLIF(current_setting('app.tenant_id', true), ''))
  WITH CHECK (tenant_id::text = NULLIF(current_setting('app.tenant_id', true), ''));
ALTER TABLE admission_enquiries FORCE ROW LEVEL SECURITY;

ALTER TABLE enquiry_followups ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS tenant_isolation ON enquiry_followups;
CREATE POLICY tenant_isolation ON enquiry_followups
  FOR ALL
  USING (tenant_id::text = NULLIF(current_setting('app.tenant_id', true), ''))
  WITH CHECK (tenant_id::text = NULLIF(current_setting('app.tenant_id', true), ''));
ALTER TABLE enquiry_followups FORCE ROW LEVEL SECURITY;

ALTER TABLE seat_matrix ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS tenant_isolation ON seat_matrix;
CREATE POLICY tenant_isolation ON seat_matrix
  FOR ALL
  USING (tenant_id::text = NULLIF(current_setting('app.tenant_id', true), ''))
  WITH CHECK (tenant_id::text = NULLIF(current_setting('app.tenant_id', true), ''));
ALTER TABLE seat_matrix FORCE ROW LEVEL SECURITY;

ALTER TABLE merit_lists ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS tenant_isolation ON merit_lists;
CREATE POLICY tenant_isolation ON merit_lists
  FOR ALL
  USING (tenant_id::text = NULLIF(current_setting('app.tenant_id', true), ''))
  WITH CHECK (tenant_id::text = NULLIF(current_setting('app.tenant_id', true), ''));
ALTER TABLE merit_lists FORCE ROW LEVEL SECURITY;

ALTER TABLE merit_list_entries ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS tenant_isolation ON merit_list_entries;
CREATE POLICY tenant_isolation ON merit_list_entries
  FOR ALL
  USING (tenant_id::text = NULLIF(current_setting('app.tenant_id', true), ''))
  WITH CHECK (tenant_id::text = NULLIF(current_setting('app.tenant_id', true), ''));
ALTER TABLE merit_list_entries FORCE ROW LEVEL SECURITY;

ALTER TABLE admission_offers ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS tenant_isolation ON admission_offers;
CREATE POLICY tenant_isolation ON admission_offers
  FOR ALL
  USING (tenant_id::text = NULLIF(current_setting('app.tenant_id', true), ''))
  WITH CHECK (tenant_id::text = NULLIF(current_setting('app.tenant_id', true), ''));
ALTER TABLE admission_offers FORCE ROW LEVEL SECURITY;
