-- Health PHI field-level break-glass grants (P0-09).
-- Dual-control temporary grants to unredact sensitive health fields.
-- Distinct from platform-admin /break-glass (tenant ops) — this is health-local.

CREATE TABLE IF NOT EXISTS health_phi_break_glass (
  id UUID PRIMARY KEY,
  tenant_id TEXT NOT NULL,
  requester_user_id TEXT NOT NULL,
  approver_user_id TEXT,
  student_id TEXT NOT NULL,
  field_path TEXT NOT NULL,
  justification TEXT NOT NULL,
  status TEXT NOT NULL,
  duration_minutes INTEGER NOT NULL,
  approved_at TIMESTAMPTZ,
  expires_at TIMESTAMPTZ,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  CONSTRAINT health_phi_bg_status_check
    CHECK (status IN ('pending', 'approved', 'denied', 'expired', 'revoked')),
  CONSTRAINT health_phi_bg_duration_check
    CHECK (duration_minutes > 0 AND duration_minutes <= 240),
  CONSTRAINT health_phi_bg_requester_ne_approver
    CHECK (approver_user_id IS NULL OR approver_user_id <> requester_user_id)
);

CREATE INDEX IF NOT EXISTS idx_health_phi_bg_active
  ON health_phi_break_glass (tenant_id, requester_user_id, student_id, field_path, status, expires_at);

CREATE INDEX IF NOT EXISTS idx_health_phi_bg_tenant_created
  ON health_phi_break_glass (tenant_id, created_at DESC);

-- Link PHI access audit rows to the break-glass grant used for unredaction.
ALTER TABLE health_phi_access_log
  ADD COLUMN IF NOT EXISTS break_glass_id TEXT;

CREATE INDEX IF NOT EXISTS idx_health_phi_access_log_break_glass
  ON health_phi_access_log (tenant_id, break_glass_id)
  WHERE break_glass_id IS NOT NULL;

-- ========================= RLS =========================
ALTER TABLE health_phi_break_glass ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS tenant_isolation ON health_phi_break_glass;
CREATE POLICY tenant_isolation ON health_phi_break_glass
  FOR ALL
  USING (tenant_id::text = NULLIF(current_setting('app.tenant_id', true), ''))
  WITH CHECK (tenant_id::text = NULLIF(current_setting('app.tenant_id', true), ''));
