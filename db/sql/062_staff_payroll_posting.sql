-- W2-HR-01: payroll posting integrity — gross/deductions/net cents + durable runs.

ALTER TABLE staff_contracts
  ADD COLUMN IF NOT EXISTS monthly_gross_cents BIGINT NOT NULL DEFAULT 0
    CHECK (monthly_gross_cents >= 0);

CREATE TABLE IF NOT EXISTS staff_payroll_runs (
  id UUID PRIMARY KEY,
  tenant_id UUID NOT NULL,
  month CHAR(7) NOT NULL,
  status TEXT NOT NULL DEFAULT 'posted'
    CHECK (status IN ('posted')),
  gross_cents BIGINT NOT NULL CHECK (gross_cents >= 0),
  deductions_cents BIGINT NOT NULL CHECK (deductions_cents >= 0),
  net_cents BIGINT NOT NULL CHECK (net_cents >= 0),
  posted_by TEXT,
  posted_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  UNIQUE (tenant_id, month),
  CHECK (net_cents = gross_cents - deductions_cents)
);
CREATE INDEX IF NOT EXISTS staff_payroll_runs_tenant_month_idx
  ON staff_payroll_runs (tenant_id, month);

CREATE TABLE IF NOT EXISTS staff_payroll_lines (
  id UUID PRIMARY KEY,
  tenant_id UUID NOT NULL,
  run_id UUID NOT NULL REFERENCES staff_payroll_runs(id) ON DELETE CASCADE,
  staff_id UUID NOT NULL,
  salary_band TEXT NOT NULL DEFAULT '',
  days_present INTEGER NOT NULL DEFAULT 0,
  leave_days INTEGER NOT NULL DEFAULT 0,
  absent_days INTEGER NOT NULL DEFAULT 0,
  payable_days NUMERIC NOT NULL DEFAULT 0,
  gross_cents BIGINT NOT NULL CHECK (gross_cents >= 0),
  deductions_cents BIGINT NOT NULL CHECK (deductions_cents >= 0),
  net_cents BIGINT NOT NULL CHECK (net_cents >= 0),
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  CHECK (net_cents = gross_cents - deductions_cents),
  UNIQUE (tenant_id, run_id, staff_id)
);

CREATE TABLE IF NOT EXISTS staff_payroll_ledger_entries (
  id UUID PRIMARY KEY,
  tenant_id UUID NOT NULL,
  run_id UUID NOT NULL REFERENCES staff_payroll_runs(id) ON DELETE CASCADE,
  journal_id UUID NOT NULL,
  account TEXT NOT NULL
    CHECK (account IN ('salary_expense', 'payroll_deductions', 'wages_payable')),
  side TEXT NOT NULL CHECK (side IN ('debit', 'credit')),
  amount_cents BIGINT NOT NULL CHECK (amount_cents > 0),
  memo TEXT,
  posted_by TEXT,
  posted_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS staff_payroll_ledger_run_idx
  ON staff_payroll_ledger_entries (tenant_id, run_id);

ALTER TABLE staff_payroll_runs ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS tenant_isolation ON staff_payroll_runs;
CREATE POLICY tenant_isolation ON staff_payroll_runs
  USING (tenant_id = NULLIF(current_setting('app.tenant_id', true), '')::uuid);
ALTER TABLE staff_payroll_runs FORCE ROW LEVEL SECURITY;

ALTER TABLE staff_payroll_lines ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS tenant_isolation ON staff_payroll_lines;
CREATE POLICY tenant_isolation ON staff_payroll_lines
  USING (tenant_id = NULLIF(current_setting('app.tenant_id', true), '')::uuid);
ALTER TABLE staff_payroll_lines FORCE ROW LEVEL SECURITY;

ALTER TABLE staff_payroll_ledger_entries ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS tenant_isolation ON staff_payroll_ledger_entries;
CREATE POLICY tenant_isolation ON staff_payroll_ledger_entries
  USING (tenant_id = NULLIF(current_setting('app.tenant_id', true), '')::uuid);
ALTER TABLE staff_payroll_ledger_entries FORCE ROW LEVEL SECURITY;
