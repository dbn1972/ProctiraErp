-- PRC-M251: bank reconciliation — idempotent imports, a matching key, and a
-- durable link from a bank line to the payment it reconciles.
--
-- Before: FeesService.importReconciliationCsv matched a bank line to an
-- invoice by invoice number and the invoice's face amount, so a partial
-- payment never matched and a line for an unpaid invoice "matched"; nothing
-- recorded which payment a line confirmed; and importing the same file twice
-- created a second batch with the same matches.
--
-- Fix (schema part; owner topic 8 Option A: reconciliation matching key
-- = (bank reference / UTR, amount in minor units, value date)):
--   1. fee_reconciliation_batches.content_hash: sha256 of the normalised CSV.
--      331 makes (tenant_id, content_hash) unique, so a re-import of the same
--      file returns the existing batch instead of creating a new one.
--   2. fee_reconciliation_rows.bank_reference (UTR) and value_date: the bank
--      side of the matching key, as imported.
--   3. fee_reconciliation_rows.payment_id: the succeeded parent_fee_payments
--      row a matched line reconciles. 331 makes a payment reconcilable once,
--      and a (bank_reference, amount_cents, value_date) bank line matchable
--      once, per tenant.
-- A matched row must name its payment (CHECK ... NOT VALID: legacy matched
-- rows, written by the face-amount rule, have none and are not rewritten).
--
-- Rollback (forward migration): drop the CHECK and the four columns
-- (331's indexes go with them).
ALTER TABLE fee_reconciliation_batches ADD COLUMN IF NOT EXISTS content_hash TEXT;
ALTER TABLE fee_reconciliation_rows ADD COLUMN IF NOT EXISTS bank_reference TEXT;
ALTER TABLE fee_reconciliation_rows ADD COLUMN IF NOT EXISTS value_date DATE;
ALTER TABLE fee_reconciliation_rows ADD COLUMN IF NOT EXISTS payment_id UUID;
ALTER TABLE fee_reconciliation_rows
  DROP CONSTRAINT IF EXISTS fee_reconciliation_rows_matched_payment_chk;
ALTER TABLE fee_reconciliation_rows
  ADD CONSTRAINT fee_reconciliation_rows_matched_payment_chk
  CHECK (NOT matched OR payment_id IS NOT NULL) NOT VALID;
INSERT INTO schema_migrations (filename)
VALUES ('330_fee_reconciliation_keys.sql')
ON CONFLICT (filename) DO NOTHING;
