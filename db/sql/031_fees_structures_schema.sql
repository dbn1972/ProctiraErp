-- Fee structures (Wave 9 / G-903): class × category × term structures,
-- instalments, concessions, refunds, and bank-reconciliation import batches.
-- Raw SQL — applied after 030 via tools/scripts/apply-sql.sh.
--
-- Staff `/fees/*` and parent-portal fee routes share parent_fee_* plus these
-- tables. RLS uses the same withPgTenant / app.tenant_id contract as 030.

ALTER TABLE parent_fee_invoices
  ADD COLUMN IF NOT EXISTS invoice_number TEXT;
ALTER TABLE parent_fee_invoices
  ADD COLUMN IF NOT EXISTS structure_id UUID;
ALTER TABLE parent_fee_invoices
  ADD COLUMN IF NOT EXISTS class_id UUID;
ALTER TABLE parent_fee_invoices
  ADD COLUMN IF NOT EXISTS grade_id UUID;

CREATE UNIQUE INDEX IF NOT EXISTS parent_fee_invoices_tenant_number_idx
  ON parent_fee_invoices (tenant_id, invoice_number)
  WHERE invoice_number IS NOT NULL;
CREATE UNIQUE INDEX IF NOT EXISTS parent_fee_invoices_structure_student_open_idx
  ON parent_fee_invoices (tenant_id, structure_id, student_id)
  WHERE structure_id IS NOT NULL AND status <> 'void';

CREATE TABLE IF NOT EXISTS fee_structures (
  id UUID PRIMARY KEY,
  tenant_id UUID NOT NULL,
  institution_id UUID,
  academic_period_id UUID,
  grade_id UUID,
  class_id UUID,
  category TEXT NOT NULL,
  term TEXT,
  code TEXT NOT NULL,
  name TEXT NOT NULL,
  amount_cents INTEGER NOT NULL CHECK (amount_cents >= 0),
  currency TEXT NOT NULL DEFAULT 'INR',
  status TEXT NOT NULL DEFAULT 'active'
    CHECK (status IN ('active', 'archived')),
  created_by TEXT,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  UNIQUE (tenant_id, code)
);
CREATE INDEX IF NOT EXISTS fee_structures_scope_idx
  ON fee_structures (tenant_id, institution_id, grade_id, class_id, category);

CREATE TABLE IF NOT EXISTS fee_structure_components (
  id UUID PRIMARY KEY,
  tenant_id UUID NOT NULL,
  structure_id UUID NOT NULL REFERENCES fee_structures(id) ON DELETE CASCADE,
  name TEXT NOT NULL,
  amount_cents INTEGER NOT NULL CHECK (amount_cents >= 0),
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS fee_structure_components_structure_idx
  ON fee_structure_components (tenant_id, structure_id);

CREATE TABLE IF NOT EXISTS fee_structure_instalments (
  id UUID PRIMARY KEY,
  tenant_id UUID NOT NULL,
  structure_id UUID NOT NULL REFERENCES fee_structures(id) ON DELETE CASCADE,
  sequence INTEGER NOT NULL CHECK (sequence >= 1),
  amount_cents INTEGER NOT NULL CHECK (amount_cents >= 0),
  due_offset_days INTEGER NOT NULL DEFAULT 0,
  label TEXT NOT NULL DEFAULT '',
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  UNIQUE (structure_id, sequence)
);
CREATE INDEX IF NOT EXISTS fee_structure_instalments_structure_idx
  ON fee_structure_instalments (tenant_id, structure_id, sequence);

CREATE TABLE IF NOT EXISTS fee_concessions (
  id UUID PRIMARY KEY,
  tenant_id UUID NOT NULL,
  student_id UUID NOT NULL,
  structure_id UUID NOT NULL REFERENCES fee_structures(id),
  invoice_id UUID REFERENCES parent_fee_invoices(id),
  kind TEXT NOT NULL CHECK (kind IN ('percent', 'amount')),
  percent NUMERIC(5, 2),
  amount_cents INTEGER,
  reason TEXT NOT NULL,
  approver_id TEXT,
  status TEXT NOT NULL DEFAULT 'approved'
    CHECK (status IN ('pending', 'approved', 'rejected')),
  created_by TEXT,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  UNIQUE (tenant_id, student_id, structure_id),
  CHECK (
    (kind = 'percent' AND percent IS NOT NULL AND percent >= 0 AND percent <= 100)
    OR (kind = 'amount' AND amount_cents IS NOT NULL AND amount_cents >= 0)
  )
);
CREATE INDEX IF NOT EXISTS fee_concessions_student_idx
  ON fee_concessions (tenant_id, student_id, structure_id);

CREATE TABLE IF NOT EXISTS fee_refunds (
  id UUID PRIMARY KEY,
  tenant_id UUID NOT NULL,
  invoice_id UUID NOT NULL REFERENCES parent_fee_invoices(id),
  payment_id UUID REFERENCES parent_fee_payments(id),
  amount_cents INTEGER NOT NULL CHECK (amount_cents > 0),
  reason TEXT NOT NULL,
  status TEXT NOT NULL DEFAULT 'posted'
    CHECK (status IN ('pending', 'posted', 'rejected')),
  created_by TEXT,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS fee_refunds_invoice_idx
  ON fee_refunds (tenant_id, invoice_id);

CREATE TABLE IF NOT EXISTS fee_reconciliation_batches (
  id UUID PRIMARY KEY,
  tenant_id UUID NOT NULL,
  filename TEXT NOT NULL DEFAULT '',
  matched_count INTEGER NOT NULL DEFAULT 0,
  unmatched_count INTEGER NOT NULL DEFAULT 0,
  created_by TEXT,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS fee_reconciliation_batches_tenant_idx
  ON fee_reconciliation_batches (tenant_id, created_at DESC);

CREATE TABLE IF NOT EXISTS fee_reconciliation_rows (
  id UUID PRIMARY KEY,
  tenant_id UUID NOT NULL,
  batch_id UUID NOT NULL REFERENCES fee_reconciliation_batches(id) ON DELETE CASCADE,
  invoice_number TEXT NOT NULL,
  amount_cents INTEGER NOT NULL,
  matched BOOLEAN NOT NULL,
  invoice_id UUID,
  note TEXT,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS fee_reconciliation_rows_batch_idx
  ON fee_reconciliation_rows (tenant_id, batch_id);

-- ---------------------------------------------------------------------------
-- RLS (same policy shape as 030; tenant bound via withPgTenant / app.tenant_id)
-- ---------------------------------------------------------------------------
ALTER TABLE fee_structures ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS tenant_isolation ON fee_structures;
CREATE POLICY tenant_isolation ON fee_structures
  FOR ALL
  USING (tenant_id::text = NULLIF(current_setting('app.tenant_id', true), ''))
  WITH CHECK (tenant_id::text = NULLIF(current_setting('app.tenant_id', true), ''));
ALTER TABLE fee_structures FORCE ROW LEVEL SECURITY;

ALTER TABLE fee_structure_components ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS tenant_isolation ON fee_structure_components;
CREATE POLICY tenant_isolation ON fee_structure_components
  FOR ALL
  USING (tenant_id::text = NULLIF(current_setting('app.tenant_id', true), ''))
  WITH CHECK (tenant_id::text = NULLIF(current_setting('app.tenant_id', true), ''));
ALTER TABLE fee_structure_components FORCE ROW LEVEL SECURITY;

ALTER TABLE fee_structure_instalments ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS tenant_isolation ON fee_structure_instalments;
CREATE POLICY tenant_isolation ON fee_structure_instalments
  FOR ALL
  USING (tenant_id::text = NULLIF(current_setting('app.tenant_id', true), ''))
  WITH CHECK (tenant_id::text = NULLIF(current_setting('app.tenant_id', true), ''));
ALTER TABLE fee_structure_instalments FORCE ROW LEVEL SECURITY;

ALTER TABLE fee_concessions ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS tenant_isolation ON fee_concessions;
CREATE POLICY tenant_isolation ON fee_concessions
  FOR ALL
  USING (tenant_id::text = NULLIF(current_setting('app.tenant_id', true), ''))
  WITH CHECK (tenant_id::text = NULLIF(current_setting('app.tenant_id', true), ''));
ALTER TABLE fee_concessions FORCE ROW LEVEL SECURITY;

ALTER TABLE fee_refunds ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS tenant_isolation ON fee_refunds;
CREATE POLICY tenant_isolation ON fee_refunds
  FOR ALL
  USING (tenant_id::text = NULLIF(current_setting('app.tenant_id', true), ''))
  WITH CHECK (tenant_id::text = NULLIF(current_setting('app.tenant_id', true), ''));
ALTER TABLE fee_refunds FORCE ROW LEVEL SECURITY;

ALTER TABLE fee_reconciliation_batches ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS tenant_isolation ON fee_reconciliation_batches;
CREATE POLICY tenant_isolation ON fee_reconciliation_batches
  FOR ALL
  USING (tenant_id::text = NULLIF(current_setting('app.tenant_id', true), ''))
  WITH CHECK (tenant_id::text = NULLIF(current_setting('app.tenant_id', true), ''));
ALTER TABLE fee_reconciliation_batches FORCE ROW LEVEL SECURITY;

ALTER TABLE fee_reconciliation_rows ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS tenant_isolation ON fee_reconciliation_rows;
CREATE POLICY tenant_isolation ON fee_reconciliation_rows
  FOR ALL
  USING (tenant_id::text = NULLIF(current_setting('app.tenant_id', true), ''))
  WITH CHECK (tenant_id::text = NULLIF(current_setting('app.tenant_id', true), ''));
ALTER TABLE fee_reconciliation_rows FORCE ROW LEVEL SECURITY;
