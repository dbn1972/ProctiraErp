-- W2-FIN-06: durable dunning suppressions + send audit (was process-local).
CREATE TABLE IF NOT EXISTS fee_reminder_suppressions (
  id UUID PRIMARY KEY,
  tenant_id UUID NOT NULL,
  student_id UUID,
  invoice_id UUID,
  reason TEXT NOT NULL,
  created_by TEXT NOT NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  CONSTRAINT fee_reminder_suppressions_target_chk CHECK (
    student_id IS NOT NULL OR invoice_id IS NOT NULL
  )
);

CREATE INDEX IF NOT EXISTS idx_fee_reminder_suppressions_tenant
  ON fee_reminder_suppressions (tenant_id, created_at DESC);

ALTER TABLE fee_reminder_suppressions ENABLE ROW LEVEL SECURITY;
ALTER TABLE fee_reminder_suppressions FORCE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS fee_reminder_suppressions_tenant ON fee_reminder_suppressions;
CREATE POLICY fee_reminder_suppressions_tenant ON fee_reminder_suppressions
  USING (tenant_id = NULLIF(current_setting('app.tenant_id', true), '')::uuid)
  WITH CHECK (tenant_id = NULLIF(current_setting('app.tenant_id', true), '')::uuid);

CREATE TABLE IF NOT EXISTS fee_reminder_send_audits (
  id UUID PRIMARY KEY,
  tenant_id UUID NOT NULL,
  invoice_id UUID NOT NULL,
  student_id UUID NOT NULL,
  channel TEXT NOT NULL CHECK (channel IN ('email', 'sms')),
  message_id TEXT NOT NULL,
  mode TEXT NOT NULL DEFAULT 'sandbox' CHECK (mode = 'sandbox'),
  honesty_note TEXT NOT NULL,
  actor_id TEXT NOT NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_fee_reminder_send_audits_tenant
  ON fee_reminder_send_audits (tenant_id, created_at DESC);

ALTER TABLE fee_reminder_send_audits ENABLE ROW LEVEL SECURITY;
ALTER TABLE fee_reminder_send_audits FORCE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS fee_reminder_send_audits_tenant ON fee_reminder_send_audits;
CREATE POLICY fee_reminder_send_audits_tenant ON fee_reminder_send_audits
  USING (tenant_id = NULLIF(current_setting('app.tenant_id', true), '')::uuid)
  WITH CHECK (tenant_id = NULLIF(current_setting('app.tenant_id', true), '')::uuid);
