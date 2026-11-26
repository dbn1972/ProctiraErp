-- PRC-M251: reconciliation uniqueness (online index builds for 330's columns).
--
--   * fee_reconciliation_batches (tenant_id, content_hash): one batch per
--     imported file content, so a re-import is idempotent.
--   * fee_reconciliation_rows (tenant_id, payment_id) WHERE matched: a payment
--     is reconciled by at most one bank line.
--   * fee_reconciliation_rows (tenant_id, bank_reference, amount_cents,
--     value_date) WHERE matched: one bank line (UTR, amount, value date)
--     reconciles at most one payment. Unmatched exception rows may repeat.
--
-- Non-transactional file: CONCURRENTLY builds on existing tables. Every
-- statement is idempotent (apply-sql.sh phase ledger), and apply-sql.sh
-- records the file only after the last phase. The columns are new (330), so
-- no existing row can violate these indexes; an interrupted build leaves an
-- INVALID index, which is dropped and rebuilt on retry, and the final block
-- asserts all three are valid.
--
-- Rollback (forward migration): DROP INDEX the three indexes below.
DO $m251_drop_invalid$
DECLARE
  idx text;
BEGIN
  FOREACH idx IN ARRAY ARRAY[
    'fee_reconciliation_batches_content_hash_uidx',
    'fee_reconciliation_rows_payment_uidx',
    'fee_reconciliation_rows_bank_line_uidx'
  ] LOOP
    IF EXISTS (
      SELECT 1
        FROM pg_class c
        JOIN pg_namespace n ON n.oid = c.relnamespace
        JOIN pg_index i ON i.indexrelid = c.oid
       WHERE n.nspname = 'public' AND c.relname = idx AND NOT i.indisvalid
    ) THEN
      EXECUTE format('DROP INDEX IF EXISTS public.%I', idx);
    END IF;
  END LOOP;
END
$m251_drop_invalid$;
CREATE UNIQUE INDEX CONCURRENTLY IF NOT EXISTS fee_reconciliation_batches_content_hash_uidx
  ON fee_reconciliation_batches (tenant_id, content_hash)
  WHERE content_hash IS NOT NULL;
CREATE UNIQUE INDEX CONCURRENTLY IF NOT EXISTS fee_reconciliation_rows_payment_uidx
  ON fee_reconciliation_rows (tenant_id, payment_id)
  WHERE matched AND payment_id IS NOT NULL;
CREATE UNIQUE INDEX CONCURRENTLY IF NOT EXISTS fee_reconciliation_rows_bank_line_uidx
  ON fee_reconciliation_rows (tenant_id, bank_reference, amount_cents, value_date)
  WHERE matched AND bank_reference IS NOT NULL AND value_date IS NOT NULL;
DO $m251_assert$
BEGIN
  IF (
    SELECT count(*)
      FROM pg_class c
      JOIN pg_namespace n ON n.oid = c.relnamespace
      JOIN pg_index i ON i.indexrelid = c.oid
     WHERE n.nspname = 'public'
       AND c.relname IN (
         'fee_reconciliation_batches_content_hash_uidx',
         'fee_reconciliation_rows_payment_uidx',
         'fee_reconciliation_rows_bank_line_uidx'
       )
       AND i.indisvalid
       AND i.indisunique
  ) <> 3 THEN
    RAISE EXCEPTION 'PRC-M251: reconciliation unique indexes missing or INVALID';
  END IF;
END
$m251_assert$;
