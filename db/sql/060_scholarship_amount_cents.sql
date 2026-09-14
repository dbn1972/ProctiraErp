-- W2-FIN-08: persist integer cents alongside scholarship NUMERIC major units
-- so fee netting can reconcile without float Math.round(amount * 100).

ALTER TABLE scholarship_disbursements
  ADD COLUMN IF NOT EXISTS amount_cents BIGINT;

UPDATE scholarship_disbursements
   SET amount_cents = ROUND(amount * 100)::bigint
 WHERE amount_cents IS NULL;

-- Remaining nulls (if any) default to 0 before NOT NULL.
UPDATE scholarship_disbursements
   SET amount_cents = 0
 WHERE amount_cents IS NULL;

ALTER TABLE scholarship_disbursements
  ALTER COLUMN amount_cents SET DEFAULT 0;

ALTER TABLE scholarship_disbursements
  ALTER COLUMN amount_cents SET NOT NULL;

ALTER TABLE scholarship_disbursements
  DROP CONSTRAINT IF EXISTS scholarship_disbursements_amount_cents_check;
ALTER TABLE scholarship_disbursements
  ADD CONSTRAINT scholarship_disbursements_amount_cents_check
  CHECK (amount_cents >= 0);

CREATE INDEX IF NOT EXISTS scholarship_disbursements_amount_cents_idx
  ON scholarship_disbursements (tenant_id, amount_cents);
