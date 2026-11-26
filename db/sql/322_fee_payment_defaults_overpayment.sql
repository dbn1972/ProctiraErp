-- PRC-M503: fee payments — no silent sandbox/succeeded defaults, a provider
-- reference, and a database overpayment guard.
--
-- 010 created parent_fee_payments with method DEFAULT 'sandbox' and status
-- DEFAULT 'succeeded', so any INSERT that forgot either column recorded a
-- real-looking, settled payment. 250 added provider_txn_id but no provider
-- name and no uniqueness. The "payments never exceed the invoice" rule lived
-- only in PgFeesRepository.recordPaymentOnInvoice; the parent-portal
-- createPayment path and direct SQL could overpay.
--
-- Fix:
--   1. DROP DEFAULT on method and status. Every runtime INSERT
--      (fees PgFeesRepository, parent-portal PgParentPortalRepository) and the
--      demo seed already name both columns; an INSERT that does not now fails
--      with 23502 instead of inventing a settled sandbox payment.
--   2. provider TEXT (nullable) next to provider_txn_id, with CHECK: a
--      provider transaction id needs a provider name. 323 makes
--      (tenant_id, provider, provider_txn_id) unique so a PSP transaction can be
--      recorded once (webhook retries). No runtime writer sets them yet; the
--      live PSP integration is WAITING_ON_INPUT (DR36: Razorpay test keys).
--   3. Overpayment guard, per (tenant_id, invoice_id):
--        SUM(parent_fee_payments.amount_cents WHERE status = 'succeeded')
--          <= parent_fee_invoices.amount_cents
--      checked by constraint triggers (the 110 pattern, invoice row locked
--      FOR UPDATE first) on payment INSERT / UPDATE of status, amount,
--      invoice or tenant, and on invoice UPDATE of amount_cents (a concession,
--      credit note or write-off may not cut the face below cash collected).
--      Error 23514, constraint name parent_fee_payments_within_invoice.
--
-- Data safety: no row is changed or re-validated. A historical invoice that is
-- already overpaid keeps its rows; it cannot take further payments or a lower
-- face. Idempotency keys stay optional; 057's partial unique index already
-- makes a supplied key unique per tenant.
--
-- Rollback (forward migration): SET DEFAULT 'sandbox' / 'succeeded' again,
-- drop the two triggers, their functions, the CHECK and the provider column.
ALTER TABLE parent_fee_payments ALTER COLUMN method DROP DEFAULT;
ALTER TABLE parent_fee_payments ALTER COLUMN status DROP DEFAULT;
ALTER TABLE parent_fee_payments ADD COLUMN IF NOT EXISTS provider TEXT;
ALTER TABLE parent_fee_payments DROP CONSTRAINT IF EXISTS parent_fee_payments_provider_ref_chk;
ALTER TABLE parent_fee_payments
  ADD CONSTRAINT parent_fee_payments_provider_ref_chk
  CHECK (
    (provider_txn_id IS NULL OR provider IS NOT NULL)
    AND (provider IS NULL OR length(trim(provider)) > 0)
  ) NOT VALID;
CREATE OR REPLACE FUNCTION fee_payments_within_invoice_assert(p_tenant_id UUID, p_invoice_id UUID)
RETURNS void
LANGUAGE plpgsql
SET search_path = public, pg_temp
AS $fn$
DECLARE
  face_cents BIGINT;
  paid_cents BIGINT;
BEGIN
  IF p_invoice_id IS NULL THEN
    RETURN;
  END IF;
  SELECT amount_cents INTO face_cents
    FROM parent_fee_invoices
   WHERE id = p_invoice_id AND tenant_id = p_tenant_id
   FOR UPDATE;
  IF NOT FOUND THEN
    RETURN;
  END IF;
  SELECT COALESCE(SUM(amount_cents), 0)::bigint INTO paid_cents
    FROM parent_fee_payments
   WHERE tenant_id = p_tenant_id AND invoice_id = p_invoice_id AND status = 'succeeded';
  IF paid_cents > face_cents THEN
    RAISE EXCEPTION
      'succeeded payments (% cents) would exceed the invoice amount (% cents) on invoice %',
      paid_cents, face_cents, p_invoice_id
      USING ERRCODE = 'check_violation',
            CONSTRAINT = 'parent_fee_payments_within_invoice';
  END IF;
END
$fn$;
CREATE OR REPLACE FUNCTION parent_fee_payments_within_invoice_trg()
RETURNS trigger
LANGUAGE plpgsql
SET search_path = public, pg_temp
AS $fn$
BEGIN
  IF NEW.status = 'succeeded' THEN
    PERFORM fee_payments_within_invoice_assert(NEW.tenant_id, NEW.invoice_id);
  END IF;
  RETURN NULL;
END
$fn$;
CREATE OR REPLACE FUNCTION parent_fee_invoices_cover_payments_trg()
RETURNS trigger
LANGUAGE plpgsql
SET search_path = public, pg_temp
AS $fn$
BEGIN
  IF NEW.amount_cents < OLD.amount_cents THEN
    PERFORM fee_payments_within_invoice_assert(NEW.tenant_id, NEW.id);
  END IF;
  RETURN NULL;
END
$fn$;
DROP TRIGGER IF EXISTS parent_fee_payments_within_invoice ON parent_fee_payments;
CREATE CONSTRAINT TRIGGER parent_fee_payments_within_invoice
  AFTER INSERT OR UPDATE OF status, amount_cents, invoice_id, tenant_id ON parent_fee_payments
  FOR EACH ROW EXECUTE FUNCTION parent_fee_payments_within_invoice_trg();
DROP TRIGGER IF EXISTS parent_fee_invoices_cover_payments ON parent_fee_invoices;
CREATE CONSTRAINT TRIGGER parent_fee_invoices_cover_payments
  AFTER UPDATE OF amount_cents ON parent_fee_invoices
  FOR EACH ROW EXECUTE FUNCTION parent_fee_invoices_cover_payments_trg();
INSERT INTO schema_migrations (filename)
VALUES ('322_fee_payment_defaults_overpayment.sql')
ON CONFLICT (filename) DO NOTHING;
