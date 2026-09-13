-- W2-FIN-02: durable payment idempotency keys (tenant-scoped).
ALTER TABLE parent_fee_payments
  ADD COLUMN IF NOT EXISTS idempotency_key TEXT;

CREATE UNIQUE INDEX IF NOT EXISTS uq_parent_fee_payments_tenant_idempotency
  ON parent_fee_payments (tenant_id, idempotency_key)
  WHERE idempotency_key IS NOT NULL;
