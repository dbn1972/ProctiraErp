-- Staff HR leave requests (raw SQL — no Prisma). Clone of hostel leave pattern.
-- Payroll deferred (peer-gap #6).

CREATE TABLE IF NOT EXISTS staff_leave_requests (
  id UUID PRIMARY KEY,
  tenant_id UUID NOT NULL,
  staff_id UUID NOT NULL,
  leave_type TEXT NOT NULL DEFAULT 'annual'
    CHECK (leave_type IN ('annual', 'sick', 'casual', 'unpaid', 'other')),
  start_date DATE NOT NULL,
  end_date DATE NOT NULL,
  reason TEXT,
  status TEXT NOT NULL DEFAULT 'pending'
    CHECK (status IN ('pending', 'approved', 'rejected', 'cancelled')),
  decided_by TEXT,
  decided_at TIMESTAMPTZ,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  CHECK (end_date >= start_date)
);

CREATE INDEX IF NOT EXISTS idx_staff_leave_requests_tenant_status
  ON staff_leave_requests (tenant_id, status);

CREATE INDEX IF NOT EXISTS idx_staff_leave_requests_staff
  ON staff_leave_requests (tenant_id, staff_id);
