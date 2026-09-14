-- W2-FIN-05: write-offs + credit notes with ledger integrity.
-- Extends invoice status, ledger accounts, and adds adjustment tables.

-- Invoice may be marked written_off when remaining AR is cleared via write-off.
ALTER TABLE parent_fee_invoices DROP CONSTRAINT IF EXISTS parent_fee_invoices_status_check;
ALTER TABLE parent_fee_invoices
  ADD CONSTRAINT parent_fee_invoices_status_check
  CHECK (status IN ('open', 'paid', 'void', 'overdue', 'written_off'));

-- Bad-debt expense account for write-offs (credit notes still use fee_revenue).
ALTER TABLE fee_ledger_entries DROP CONSTRAINT IF EXISTS fee_ledger_entries_account_check;
ALTER TABLE fee_ledger_entries
  ADD CONSTRAINT fee_ledger_entries_account_check
  CHECK (account IN ('accounts_receivable', 'cash', 'fee_revenue', 'bad_debt_expense'));

CREATE TABLE IF NOT EXISTS fee_credit_notes (
  id UUID PRIMARY KEY,
  tenant_id UUID NOT NULL,
  invoice_id UUID NOT NULL REFERENCES parent_fee_invoices(id),
  amount_cents INTEGER NOT NULL CHECK (amount_cents > 0),
  reason TEXT NOT NULL,
  status TEXT NOT NULL DEFAULT 'posted'
    CHECK (status IN ('posted', 'voided')),
  created_by TEXT,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS fee_credit_notes_invoice_idx
  ON fee_credit_notes (tenant_id, invoice_id);

CREATE TABLE IF NOT EXISTS fee_write_offs (
  id UUID PRIMARY KEY,
  tenant_id UUID NOT NULL,
  invoice_id UUID NOT NULL REFERENCES parent_fee_invoices(id),
  amount_cents INTEGER NOT NULL CHECK (amount_cents > 0),
  reason TEXT NOT NULL,
  status TEXT NOT NULL DEFAULT 'posted'
    CHECK (status IN ('posted', 'voided')),
  created_by TEXT,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS fee_write_offs_invoice_idx
  ON fee_write_offs (tenant_id, invoice_id);

ALTER TABLE fee_credit_notes ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS tenant_isolation ON fee_credit_notes;
CREATE POLICY tenant_isolation ON fee_credit_notes
  USING (tenant_id = NULLIF(current_setting('app.tenant_id', true), '')::uuid);
ALTER TABLE fee_credit_notes FORCE ROW LEVEL SECURITY;

ALTER TABLE fee_write_offs ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS tenant_isolation ON fee_write_offs;
CREATE POLICY tenant_isolation ON fee_write_offs
  USING (tenant_id = NULLIF(current_setting('app.tenant_id', true), '')::uuid);
ALTER TABLE fee_write_offs FORCE ROW LEVEL SECURITY;
