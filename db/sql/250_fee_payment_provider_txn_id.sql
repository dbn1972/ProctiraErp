-- PRC-M503: narrow schema-only column for parent_fee_payments to eventually
-- record the payment-service-provider transaction id once real PSP
-- integration lands. The core finding (payments are sandbox-only; there is
-- no real provider to reconcile against) stays OPEN per Decision D1's
-- existing note that the real blocker is PSP/provider integration, not this
-- schema gap -- this migration only removes the smaller, purely additive
-- schema obstacle so that integration does not also need a migration later.
--
-- Nullable, no default, no CHECK, no index -- intentionally inert. Existing
-- INSERT INTO parent_fee_payments call sites in packages/backend/fees/src and
-- packages/backend/parent-portal/src all use explicit column lists (grepped;
-- none rely on column count or `INSERT ... SELECT *`), so they are unaffected
-- by this additive column.
--
-- Rollback: forward-only; a later migration may add the CHECK/index/default
-- a real PSP integration needs once that work begins.

ALTER TABLE parent_fee_payments
  ADD COLUMN IF NOT EXISTS provider_txn_id TEXT;

INSERT INTO schema_migrations (filename)
VALUES ('250_fee_payment_provider_txn_id.sql')
ON CONFLICT (filename) DO NOTHING;
