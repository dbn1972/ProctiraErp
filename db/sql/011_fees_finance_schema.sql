-- Fees & finance v1 (extend parent-portal 010 — raw SQL, no Prisma).
-- Fee plans, optional plan_id on invoices, sandbox payment receipts.
-- Does NOT touch SaaS packages/backend/billing.

CREATE TABLE IF NOT EXISTS parent_fee_plans (
  id UUID PRIMARY KEY,
  tenant_id UUID NOT NULL,
  code TEXT NOT NULL,
  name TEXT NOT NULL,
  description TEXT NOT NULL DEFAULT '',
  amount_cents INTEGER NOT NULL CHECK (amount_cents >= 0),
  currency TEXT NOT NULL DEFAULT 'INR',
  frequency TEXT NOT NULL DEFAULT 'term'
    CHECK (frequency IN ('once', 'term', 'month', 'year')),
  status TEXT NOT NULL DEFAULT 'active'
    CHECK (status IN ('active', 'archived')),
  created_by TEXT,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  UNIQUE (tenant_id, code)
);

CREATE INDEX IF NOT EXISTS idx_parent_fee_plans_tenant
  ON parent_fee_plans (tenant_id, status);

ALTER TABLE parent_fee_invoices
  ADD COLUMN IF NOT EXISTS plan_id UUID REFERENCES parent_fee_plans(id);

CREATE INDEX IF NOT EXISTS idx_parent_fee_invoices_plan
  ON parent_fee_invoices (tenant_id, plan_id)
  WHERE plan_id IS NOT NULL;

CREATE TABLE IF NOT EXISTS parent_fee_receipts (
  id UUID PRIMARY KEY,
  tenant_id UUID NOT NULL,
  payment_id UUID NOT NULL REFERENCES parent_fee_payments(id),
  invoice_id UUID NOT NULL REFERENCES parent_fee_invoices(id),
  receipt_number TEXT NOT NULL,
  amount_cents INTEGER NOT NULL CHECK (amount_cents >= 0),
  currency TEXT NOT NULL DEFAULT 'INR',
  issued_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  UNIQUE (tenant_id, receipt_number),
  UNIQUE (payment_id)
);

CREATE INDEX IF NOT EXISTS idx_parent_fee_receipts_invoice
  ON parent_fee_receipts (tenant_id, invoice_id);
