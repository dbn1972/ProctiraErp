-- W1-DATA-09: integer minor units for scholarship program awards.
-- Dual-write with amount_per_recipient (NUMERIC major) so existing API/UI
-- can keep major-unit display while cents is the ledger/reconcile source of truth.
-- Applied after 060 via apply-sql.sh / ensureScholarshipSchema.

ALTER TABLE scholarship_programs
  ADD COLUMN IF NOT EXISTS amount_per_recipient_cents BIGINT;

UPDATE scholarship_programs
   SET amount_per_recipient_cents = ROUND(amount_per_recipient * 100)::bigint
 WHERE amount_per_recipient_cents IS NULL;

UPDATE scholarship_programs
   SET amount_per_recipient_cents = 0
 WHERE amount_per_recipient_cents IS NULL;

ALTER TABLE scholarship_programs
  ALTER COLUMN amount_per_recipient_cents SET DEFAULT 0;

ALTER TABLE scholarship_programs
  ALTER COLUMN amount_per_recipient_cents SET NOT NULL;

ALTER TABLE scholarship_programs
  DROP CONSTRAINT IF EXISTS scholarship_programs_amount_per_recipient_cents_check;
ALTER TABLE scholarship_programs
  ADD CONSTRAINT scholarship_programs_amount_per_recipient_cents_check
  CHECK (amount_per_recipient_cents >= 0);

CREATE INDEX IF NOT EXISTS scholarship_programs_amount_per_recipient_cents_idx
  ON scholarship_programs (tenant_id, amount_per_recipient_cents);
