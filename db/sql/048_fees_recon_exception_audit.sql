-- F3 — reconciliation exception workflow + audit columns (additive).
-- matched rows keep exception_status = 'none'; unmatched start as 'open'.

ALTER TABLE fee_reconciliation_rows
  ADD COLUMN IF NOT EXISTS exception_status TEXT NOT NULL DEFAULT 'none';

ALTER TABLE fee_reconciliation_rows
  ADD COLUMN IF NOT EXISTS resolved_by TEXT;

ALTER TABLE fee_reconciliation_rows
  ADD COLUMN IF NOT EXISTS resolved_at TIMESTAMPTZ;

ALTER TABLE fee_reconciliation_rows
  ADD COLUMN IF NOT EXISTS resolution_note TEXT;

-- Backfill unmatched rows that pre-date this migration.
UPDATE fee_reconciliation_rows
SET exception_status = 'open'
WHERE matched = false
  AND exception_status = 'none';

CREATE INDEX IF NOT EXISTS fee_reconciliation_rows_exception_idx
  ON fee_reconciliation_rows (tenant_id, exception_status)
  WHERE exception_status <> 'none';
