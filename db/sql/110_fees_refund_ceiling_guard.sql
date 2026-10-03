-- PRC-H058: posted refunds may never exceed succeeded payments on an invoice.
--
-- Invariant, per (tenant_id, invoice_id):
--   SUM(fee_refunds.amount_cents WHERE status = 'posted')
--     <= SUM(parent_fee_payments.amount_cents WHERE status = 'succeeded')
--
-- A row-level CHECK cannot read other rows, so the invariant is enforced by
-- constraint triggers on both sides:
--   * fee_refunds        INSERT / UPDATE (posting, amount or invoice change)
--   * parent_fee_payments UPDATE / DELETE (a succeeded payment is reduced,
--                                           un-succeeded, moved or removed)
-- Each trigger locks the parent invoice row FOR UPDATE first, matching the lock
-- PgFeesRepository.withInvoiceLock already takes, so concurrent refunds on one
-- invoice serialise instead of both passing a stale sum. Same-transaction
-- re-locking is free; lock order (invoice first) matches the application path.
--
-- The triggers run as the invoking role (SECURITY INVOKER), so the sums are taken
-- under the caller's tenant RLS scope. Every legitimate writer already binds
-- app.tenant_id to the row's tenant (fee_refunds WITH CHECK requires it).
--
-- Data safety: no existing row is changed or re-validated. Triggers only fire on
-- new writes, so a historical invoice that is already over-refunded keeps its
-- rows but cannot be refunded further or have its payments reduced. New, error
-- code 23514 (check_violation) with constraint name fee_refunds_within_payments.
--
-- Rollback: forward-only; a later migration may DROP the two triggers (no data
-- depends on them).

CREATE OR REPLACE FUNCTION fee_refund_ceiling_assert(p_tenant_id UUID, p_invoice_id UUID)
RETURNS void
LANGUAGE plpgsql
SET search_path = public, pg_temp
AS $fn$
DECLARE
  paid_cents BIGINT;
  refunded_cents BIGINT;
BEGIN
  IF p_invoice_id IS NULL THEN
    RETURN;
  END IF;
  PERFORM 1 FROM parent_fee_invoices WHERE id = p_invoice_id FOR UPDATE;

  SELECT COALESCE(SUM(amount_cents), 0)::bigint INTO paid_cents
    FROM parent_fee_payments
   WHERE tenant_id = p_tenant_id AND invoice_id = p_invoice_id AND status = 'succeeded';
  SELECT COALESCE(SUM(amount_cents), 0)::bigint INTO refunded_cents
    FROM fee_refunds
   WHERE tenant_id = p_tenant_id AND invoice_id = p_invoice_id AND status = 'posted';

  IF refunded_cents > paid_cents THEN
    RAISE EXCEPTION
      'posted refunds (% cents) would exceed succeeded payments (% cents) on invoice %',
      refunded_cents, paid_cents, p_invoice_id
      USING ERRCODE = 'check_violation',
            CONSTRAINT = 'fee_refunds_within_payments';
  END IF;
END
$fn$;

CREATE OR REPLACE FUNCTION fee_refunds_ceiling_trg()
RETURNS trigger
LANGUAGE plpgsql
SET search_path = public, pg_temp
AS $fn$
BEGIN
  IF NEW.status = 'posted' THEN
    PERFORM fee_refund_ceiling_assert(NEW.tenant_id, NEW.invoice_id);
  END IF;
  RETURN NULL;
END
$fn$;

CREATE OR REPLACE FUNCTION parent_fee_payments_ceiling_trg()
RETURNS trigger
LANGUAGE plpgsql
SET search_path = public, pg_temp
AS $fn$
BEGIN
  -- Only a change that can lower an invoice's succeeded total matters.
  IF OLD.status = 'succeeded' THEN
    IF TG_OP = 'DELETE'
       OR NEW.status IS DISTINCT FROM 'succeeded'
       OR NEW.amount_cents < OLD.amount_cents
       OR NEW.invoice_id IS DISTINCT FROM OLD.invoice_id
       OR NEW.tenant_id IS DISTINCT FROM OLD.tenant_id THEN
      PERFORM fee_refund_ceiling_assert(OLD.tenant_id, OLD.invoice_id);
    END IF;
  END IF;
  RETURN NULL;
END
$fn$;

-- AFTER ... constraint triggers (not deferrable): they see the statement's own
-- row, so the sums include the write being checked.
DROP TRIGGER IF EXISTS fee_refunds_within_payments ON fee_refunds;
CREATE CONSTRAINT TRIGGER fee_refunds_within_payments
  AFTER INSERT OR UPDATE OF status, amount_cents, invoice_id, tenant_id ON fee_refunds
  FOR EACH ROW EXECUTE FUNCTION fee_refunds_ceiling_trg();

DROP TRIGGER IF EXISTS parent_fee_payments_cover_refunds ON parent_fee_payments;
CREATE CONSTRAINT TRIGGER parent_fee_payments_cover_refunds
  AFTER UPDATE OF status, amount_cents, invoice_id, tenant_id OR DELETE ON parent_fee_payments
  FOR EACH ROW EXECUTE FUNCTION parent_fee_payments_ceiling_trg();

-- EXECUTE stays at the PUBLIC default on purpose: the assert runs as the writer,
-- so every role that may write refunds/payments must be able to call it. It only
-- reads under the caller's own RLS scope and locks an invoice row the caller
-- could already lock (FOR UPDATE needs UPDATE on parent_fee_invoices).
