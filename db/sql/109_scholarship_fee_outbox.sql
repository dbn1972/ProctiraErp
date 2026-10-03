-- PRC-H084: scholarship disbursement -> fees transactional outbox.
--
-- When a disbursement flips to / away from 'paid', the status write and one row
-- here are committed in the same transaction; the fee-netting hook is then
-- dispatched from this table (immediately, by the retry worker, and by the
-- reconcile/replay job) until it succeeds ('done') or is dead-lettered
-- ('failed'). Column names match PgScholarshipFeeOutbox
-- (packages/backend/scholarship/src/scholarship-fee-outbox.ts), which probes
-- to_regclass('scholarship_fee_outbox') and falls back to the legacy path when
-- the table is absent.
--
-- New, empty table: ordinary transactional DDL. Idempotent.
-- Rollback: forward-only. Code degrades to the legacy hook path if the table is
-- dropped by a later migration, but pending rows would be lost — drain first.

CREATE TABLE IF NOT EXISTS scholarship_fee_outbox (
  id UUID PRIMARY KEY,
  tenant_id UUID NOT NULL REFERENCES tenants(id),
  disbursement_id UUID NOT NULL
    REFERENCES scholarship_disbursements(id) ON DELETE CASCADE,
  event TEXT NOT NULL
    CHECK (event IN ('disbursement.paid', 'disbursement.reversed')),
  status TEXT NOT NULL DEFAULT 'pending'
    CHECK (status IN ('pending', 'done', 'failed')),
  attempts INTEGER NOT NULL DEFAULT 0 CHECK (attempts >= 0),
  last_error TEXT CHECK (last_error IS NULL OR length(last_error) <= 2000),
  next_attempt_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

-- listDue: pending rows due now, oldest first (per tenant).
CREATE INDEX IF NOT EXISTS scholarship_fee_outbox_due_idx
  ON scholarship_fee_outbox (tenant_id, status, next_attempt_at, created_at);

-- Reconcile / per-disbursement lookups.
CREATE INDEX IF NOT EXISTS scholarship_fee_outbox_disbursement_idx
  ON scholarship_fee_outbox (tenant_id, disbursement_id, created_at);

ALTER TABLE scholarship_fee_outbox ENABLE ROW LEVEL SECURITY;
ALTER TABLE scholarship_fee_outbox FORCE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS tenant_isolation ON scholarship_fee_outbox;
CREATE POLICY tenant_isolation ON scholarship_fee_outbox
  FOR ALL
  USING (tenant_id::text = NULLIF(current_setting('app.tenant_id', true), ''))
  WITH CHECK (tenant_id::text = NULLIF(current_setting('app.tenant_id', true), ''));

COMMENT ON TABLE scholarship_fee_outbox IS
  'PRC-H084 disbursement->fees netting outbox; written in the disbursement status transaction.';

DO $$
BEGIN
  IF EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'proctira_app') THEN
    GRANT SELECT, INSERT, UPDATE, DELETE ON TABLE scholarship_fee_outbox TO proctira_app;
  END IF;
END $$;
