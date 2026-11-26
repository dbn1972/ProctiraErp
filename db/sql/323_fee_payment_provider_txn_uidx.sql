-- PRC-M503: a payment-service-provider transaction is recorded at most once
-- per tenant.
--
-- 322 added parent_fee_payments.provider next to 250's provider_txn_id. A PSP
-- delivers the same transaction more than once (webhook retries, a callback
-- plus a status poll), so the database, not only the application, must refuse
-- a second payment row for one (tenant_id, provider, provider_txn_id).
--
-- Non-transactional file: the index is on an existing, populated table, so it
-- is built online (CONCURRENTLY). Every statement is idempotent (apply-sql.sh
-- phase ledger), and apply-sql.sh records the file in schema_migrations only
-- after the last phase, so this file does not insert its own ledger row. No runtime writer sets provider_txn_id yet, so no duplicates
-- can exist; the preflight still refuses to build over any instead of
-- deleting money rows.
--
-- Rollback (forward migration): DROP INDEX
-- parent_fee_payments_provider_txn_uidx; no data depends on it.
DO $m503_preflight$
DECLARE
  was_forced boolean;
  duplicate_groups bigint;
BEGIN
  SELECT relforcerowsecurity INTO was_forced
    FROM pg_class WHERE oid = 'public.parent_fee_payments'::regclass;
  IF was_forced THEN
    ALTER TABLE parent_fee_payments NO FORCE ROW LEVEL SECURITY;
  END IF;
  SELECT count(*) INTO duplicate_groups
    FROM (
      SELECT 1
        FROM parent_fee_payments
       WHERE provider_txn_id IS NOT NULL
       GROUP BY tenant_id, provider, provider_txn_id
      HAVING count(*) > 1
    ) d;
  IF was_forced THEN
    ALTER TABLE parent_fee_payments FORCE ROW LEVEL SECURITY;
  END IF;
  IF duplicate_groups > 0 THEN
    RAISE EXCEPTION
      'PRC-M503: % provider transaction(s) are recorded on more than one payment; '
      'reconcile them before re-running',
      duplicate_groups;
  END IF;
END
$m503_preflight$;
DO $m503_drop_invalid$
BEGIN
  IF EXISTS (
    SELECT 1
      FROM pg_class c
      JOIN pg_namespace n ON n.oid = c.relnamespace
      JOIN pg_index i ON i.indexrelid = c.oid
     WHERE n.nspname = 'public'
       AND c.relname = 'parent_fee_payments_provider_txn_uidx'
       AND NOT i.indisvalid
  ) THEN
    EXECUTE 'DROP INDEX IF EXISTS public.parent_fee_payments_provider_txn_uidx';
  END IF;
END
$m503_drop_invalid$;
CREATE UNIQUE INDEX CONCURRENTLY IF NOT EXISTS parent_fee_payments_provider_txn_uidx
  ON parent_fee_payments (tenant_id, provider, provider_txn_id)
  WHERE provider_txn_id IS NOT NULL;
DO $m503_assert$
BEGIN
  IF NOT EXISTS (
    SELECT 1
      FROM pg_class c
      JOIN pg_namespace n ON n.oid = c.relnamespace
      JOIN pg_index i ON i.indexrelid = c.oid
     WHERE n.nspname = 'public'
       AND c.relname = 'parent_fee_payments_provider_txn_uidx'
       AND i.indisvalid
       AND i.indisunique
  ) THEN
    RAISE EXCEPTION 'PRC-M503: parent_fee_payments_provider_txn_uidx missing or INVALID';
  END IF;
END
$m503_assert$;
