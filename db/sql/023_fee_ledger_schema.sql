-- 023_fee_ledger_schema.sql — G-718: double-entry fee ledger.
--
-- Fees previously relied on an amount-equality check (payment == invoice ==
-- receipt). Every financial event now posts a balanced journal:
--   invoice issued : DR accounts_receivable / CR fee_revenue
--   payment posted : DR cash                / CR accounts_receivable
--   invoice voided : DR fee_revenue         / CR accounts_receivable
--
-- Invariants enforced in the database, not the service:
--   * rows are append-only (UPDATE/DELETE rejected)
--   * every journal_id balances (SUM debit = SUM credit) — checked by a
--     DEFERRABLE INITIALLY DEFERRED constraint trigger at COMMIT, so a partial
--     journal can never be committed.
--   * RLS + FORCE on tenant_id, same GUC convention as 015.

CREATE EXTENSION IF NOT EXISTS "uuid-ossp";

CREATE TABLE IF NOT EXISTS fee_ledger_entries (
  id            UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  tenant_id     UUID NOT NULL,
  journal_id    UUID NOT NULL,
  invoice_id    UUID NOT NULL,
  payment_id    UUID,
  receipt_id    UUID,
  account       TEXT NOT NULL CHECK (account IN ('accounts_receivable', 'cash', 'fee_revenue')),
  side          TEXT NOT NULL CHECK (side IN ('debit', 'credit')),
  amount_cents  BIGINT NOT NULL CHECK (amount_cents > 0),
  currency      TEXT NOT NULL,
  memo          TEXT,
  posted_by     TEXT,
  posted_at     TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  created_at    TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS fee_ledger_entries_tenant_invoice_idx
  ON fee_ledger_entries (tenant_id, invoice_id, posted_at);
CREATE INDEX IF NOT EXISTS fee_ledger_entries_tenant_journal_idx
  ON fee_ledger_entries (tenant_id, journal_id);
CREATE INDEX IF NOT EXISTS fee_ledger_entries_tenant_account_idx
  ON fee_ledger_entries (tenant_id, account, posted_at);

-- Append-only
CREATE OR REPLACE FUNCTION fee_ledger_entries_append_only() RETURNS trigger AS $$
BEGIN
  RAISE EXCEPTION 'fee_ledger_entries is append-only (% rejected)', TG_OP;
END;
$$ LANGUAGE plpgsql;

DROP TRIGGER IF EXISTS trg_fee_ledger_append_only ON fee_ledger_entries;
CREATE TRIGGER trg_fee_ledger_append_only
  BEFORE UPDATE OR DELETE ON fee_ledger_entries
  FOR EACH ROW EXECUTE FUNCTION fee_ledger_entries_append_only();

-- Balanced journals, verified at COMMIT
CREATE OR REPLACE FUNCTION fee_ledger_journal_balanced() RETURNS trigger AS $$
DECLARE
  debits  BIGINT;
  credits BIGINT;
BEGIN
  SELECT COALESCE(SUM(CASE WHEN side = 'debit'  THEN amount_cents END), 0),
         COALESCE(SUM(CASE WHEN side = 'credit' THEN amount_cents END), 0)
    INTO debits, credits
    FROM fee_ledger_entries
   WHERE journal_id = NEW.journal_id AND tenant_id = NEW.tenant_id;
  IF debits <> credits THEN
    RAISE EXCEPTION 'fee ledger journal % is unbalanced (debit % <> credit %)',
      NEW.journal_id, debits, credits
      USING ERRCODE = 'integrity_constraint_violation';
  END IF;
  RETURN NULL;
END;
$$ LANGUAGE plpgsql;

DROP TRIGGER IF EXISTS trg_fee_ledger_journal_balanced ON fee_ledger_entries;
CREATE CONSTRAINT TRIGGER trg_fee_ledger_journal_balanced
  AFTER INSERT ON fee_ledger_entries
  DEFERRABLE INITIALLY DEFERRED
  FOR EACH ROW EXECUTE FUNCTION fee_ledger_journal_balanced();

-- RLS
ALTER TABLE fee_ledger_entries ENABLE ROW LEVEL SECURITY;
ALTER TABLE fee_ledger_entries FORCE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS tenant_isolation ON fee_ledger_entries;
CREATE POLICY tenant_isolation ON fee_ledger_entries FOR ALL
  USING (tenant_id::text = NULLIF(current_setting('app.tenant_id', true), ''))
  WITH CHECK (tenant_id::text = NULLIF(current_setting('app.tenant_id', true), ''));

INSERT INTO schema_migrations (filename)
VALUES ('023_fee_ledger_schema.sql')
ON CONFLICT (filename) DO NOTHING;
