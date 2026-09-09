-- Staff / HR ops (Wave 9 / G-918): contracts, qualifications, daily attendance.
-- Raw SQL — applied after 036 via tools/scripts/apply-sql.sh.
--
-- RLS: tenant bound via withPgTenant / app.tenant_id (same policy shape as 030/036).
-- Payroll is computed from contracts + attendance (no payroll ledger table).

CREATE TABLE IF NOT EXISTS staff_contracts (
  id UUID PRIMARY KEY,
  tenant_id UUID NOT NULL,
  staff_id UUID NOT NULL,
  contract_type TEXT NOT NULL
    CHECK (contract_type IN ('permanent', 'probation', 'fixed_term', 'visiting', 'intern')),
  start_date DATE NOT NULL,
  end_date DATE,
  salary_band TEXT NOT NULL DEFAULT '',
  status TEXT NOT NULL DEFAULT 'active'
    CHECK (status IN ('draft', 'active', 'expired', 'terminated')),
  notes TEXT,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  CHECK (end_date IS NULL OR end_date >= start_date)
);
CREATE INDEX IF NOT EXISTS staff_contracts_tenant_staff_idx
  ON staff_contracts (tenant_id, staff_id);
CREATE INDEX IF NOT EXISTS staff_contracts_tenant_status_end_idx
  ON staff_contracts (tenant_id, status, end_date);

CREATE TABLE IF NOT EXISTS staff_qualifications (
  id UUID PRIMARY KEY,
  tenant_id UUID NOT NULL,
  staff_id UUID NOT NULL,
  degree TEXT NOT NULL,
  institution TEXT NOT NULL,
  year INTEGER NOT NULL CHECK (year >= 1950 AND year <= 2100),
  verified BOOLEAN NOT NULL DEFAULT false,
  document_ref TEXT,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS staff_qualifications_tenant_staff_idx
  ON staff_qualifications (tenant_id, staff_id);

CREATE TABLE IF NOT EXISTS staff_attendance (
  id UUID PRIMARY KEY,
  tenant_id UUID NOT NULL,
  staff_id UUID NOT NULL,
  attendance_date DATE NOT NULL,
  status TEXT NOT NULL
    CHECK (status IN ('present', 'absent', 'leave', 'half_day')),
  notes TEXT,
  marked_by TEXT,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  UNIQUE (tenant_id, staff_id, attendance_date)
);
CREATE INDEX IF NOT EXISTS staff_attendance_tenant_date_idx
  ON staff_attendance (tenant_id, attendance_date);
CREATE INDEX IF NOT EXISTS staff_attendance_tenant_staff_idx
  ON staff_attendance (tenant_id, staff_id, attendance_date);

-- ---------------------------------------------------------------------------
-- RLS (same policy shape as 030; tenant bound via withPgTenant / app.tenant_id)
-- ---------------------------------------------------------------------------
ALTER TABLE staff_contracts ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS tenant_isolation ON staff_contracts;
CREATE POLICY tenant_isolation ON staff_contracts
  FOR ALL
  USING (tenant_id::text = NULLIF(current_setting('app.tenant_id', true), ''))
  WITH CHECK (tenant_id::text = NULLIF(current_setting('app.tenant_id', true), ''));
ALTER TABLE staff_contracts FORCE ROW LEVEL SECURITY;

ALTER TABLE staff_qualifications ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS tenant_isolation ON staff_qualifications;
CREATE POLICY tenant_isolation ON staff_qualifications
  FOR ALL
  USING (tenant_id::text = NULLIF(current_setting('app.tenant_id', true), ''))
  WITH CHECK (tenant_id::text = NULLIF(current_setting('app.tenant_id', true), ''));
ALTER TABLE staff_qualifications FORCE ROW LEVEL SECURITY;

ALTER TABLE staff_attendance ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS tenant_isolation ON staff_attendance;
CREATE POLICY tenant_isolation ON staff_attendance
  FOR ALL
  USING (tenant_id::text = NULLIF(current_setting('app.tenant_id', true), ''))
  WITH CHECK (tenant_id::text = NULLIF(current_setting('app.tenant_id', true), ''));
ALTER TABLE staff_attendance FORCE ROW LEVEL SECURITY;
