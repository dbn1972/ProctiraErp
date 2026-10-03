-- PRC-H058 (fix step 3) — database guard: posted refunds never exceed succeeded payments.
--
-- The fees service already checks the cap under SELECT ... FOR UPDATE on the invoice
-- (FeesRepository.withInvoiceLock). This trigger is defence in depth for any writer that
-- bypasses the service (scripts, future code paths, manual SQL): a posted refund row that
-- would push SUM(posted refunds) above SUM(succeeded payments) for its invoice is rejected.
--
-- Concurrency: the trigger takes the same invoice row lock the service takes, so two
-- concurrent refund inserts on one invoice serialize and the second sees the first.
-- SECURITY INVOKER: sums run under the caller's RLS tenant context; tenant_id is also
-- matched explicitly. Existing rows are not re-checked (trigger applies to new writes).
--
-- Additive / idempotent. Needs DB review.

CREATE OR REPLACE FUNCTION fee_refunds_enforce_payment_cap()
RETURNS trigger
LANGUAGE plpgsql
AS $$
DECLARE
  paid_cents BIGINT;
  refunded_cents BIGINT;
BEGIN
  IF NEW.status IS DISTINCT FROM 'posted' THEN
    RETURN NEW;
  END IF;

  -- Serialize with FeesRepository.withInvoiceLock and other refund writers.
  PERFORM 1
     FROM parent_fee_invoices
    WHERE id = NEW.invoice_id
      AND tenant_id = NEW.tenant_id
    FOR UPDATE;

  SELECT COALESCE(SUM(amount_cents), 0)::bigint
    INTO paid_cents
    FROM parent_fee_payments
   WHERE tenant_id = NEW.tenant_id
     AND invoice_id = NEW.invoice_id
     AND status = 'succeeded';

  SELECT COALESCE(SUM(amount_cents), 0)::bigint
    INTO refunded_cents
    FROM fee_refunds
   WHERE tenant_id = NEW.tenant_id
     AND invoice_id = NEW.invoice_id
     AND status = 'posted'
     AND id IS DISTINCT FROM NEW.id;

  IF refunded_cents + NEW.amount_cents > paid_cents THEN
    RAISE EXCEPTION 'fee refund exceeds succeeded payments for invoice % (paid %, refunded %, new %)',
      NEW.invoice_id, paid_cents, refunded_cents, NEW.amount_cents
      USING ERRCODE = 'check_violation',
            CONSTRAINT = 'fee_refunds_payment_cap';
  END IF;

  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS fee_refunds_payment_cap ON fee_refunds;
CREATE TRIGGER fee_refunds_payment_cap
  BEFORE INSERT OR UPDATE OF amount_cents, status, invoice_id, tenant_id
  ON fee_refunds
  FOR EACH ROW
  EXECUTE FUNCTION fee_refunds_enforce_payment_cap();

-- RLS is already ENABLE + FORCE on fee_refunds (031/047); re-asserted for this contract.
ALTER TABLE fee_refunds ENABLE ROW LEVEL SECURITY;
ALTER TABLE fee_refunds FORCE ROW LEVEL SECURITY;

DO $$
BEGIN
  IF EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'proctira_app') THEN
    GRANT SELECT, INSERT, UPDATE ON fee_refunds TO proctira_app;
    GRANT EXECUTE ON FUNCTION fee_refunds_enforce_payment_cap() TO proctira_app;
  END IF;
END $$;

INSERT INTO schema_migrations (filename)
VALUES ('150_fee_refund_cap_guard.sql')
ON CONFLICT (filename) DO NOTHING;
