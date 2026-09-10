-- HR leave balances (G-206 residual). Complements 013_hr_leave_schema.sql.
-- Days are whole calendar days deducted on approve.

CREATE TABLE IF NOT EXISTS staff_leave_balances (
  tenant_id UUID NOT NULL,
  staff_id UUID NOT NULL,
  leave_type TEXT NOT NULL
    CHECK (leave_type IN ('annual', 'sick', 'casual', 'unpaid', 'other')),
  balance_days NUMERIC(8, 2) NOT NULL DEFAULT 0
    CHECK (balance_days >= 0),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  PRIMARY KEY (tenant_id, staff_id, leave_type)
);

ALTER TABLE staff_leave_balances ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS tenant_isolation ON staff_leave_balances;
CREATE POLICY tenant_isolation ON staff_leave_balances
  FOR ALL
  USING (tenant_id::text = NULLIF(current_setting('app.tenant_id', true), ''))
  WITH CHECK (tenant_id::text = NULLIF(current_setting('app.tenant_id', true), ''));
