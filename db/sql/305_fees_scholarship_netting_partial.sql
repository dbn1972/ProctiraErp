-- F-D1 / F-D2: a paid scholarship disbursement may now be netted across several
-- invoices. Each netting credits at most one invoice's open amount; the remainder
-- stays on the disbursement and is credited to the student's next open invoice.
-- That needs one fee_concessions netting row per (disbursement, invoice), so the
-- one-row-per-disbursement unique index from db/sql/061 is replaced by:
--   * uq_fee_concessions_source_disbursement_invoice: at most one netting row per
--     disbursement and credited invoice (a second netting of the same money into
--     the same invoice fails with 23505 even if the service lock were bypassed);
--   * uq_fee_concessions_source_disbursement_reserved: at most one legacy
--     "credit reserved" row (invoice_id NULL) per disbursement. The service no
--     longer creates those rows; existing ones are reported by
--     tools/scripts/fees-scholarship-netting-report.sql.
-- Concurrent nettings of one disbursement serialize on a transaction-scoped
-- advisory lock in PgFeesRepository.withScholarshipDisbursementLock.
--
-- No data is changed. Existing rows satisfy both new indexes because the old index
-- (tenant_id, source_disbursement_id) was stricter, so no duplicate preflight is
-- needed. Historical rows that netted the wrong amount (F-D1 ₹0 credit, F-D2
-- capped credit) are left as they are; see
-- docs/runbooks/fees-scholarship-netting-remediation.md.
--
-- Same pattern as db/sql/254 (W1-DATA-17): CREATE/DROP INDEX CONCURRENTLY cannot
-- run inside a transaction, so apply-sql.sh applies this file statement by
-- statement through the schema_migration_phases ledger. Each statement is
-- idempotent compensating-forward DDL: (1) drop an INVALID leftover from an
-- interrupted build, (2) build, (3) assert present + valid + unique, and only then
-- (4) drop the old index. Lock: SHARE UPDATE EXCLUSIVE on fee_concessions for the
-- builds (reads and writes continue). apply-sql.sh's lock_timeout /
-- statement_timeout apply.
--
-- Rollback (forward-only repo; body of a future revert migration): rebuild the
-- db/sql/061 partial unique index on (tenant_id, source_disbursement_id) and then
-- drop the two indexes created here. That rebuild fails while any disbursement has
-- more than one netting row, so roll the application back first and keep this
-- schema (the old code reads it correctly: it sees the first netting row).
-- Data loss on rollback: none (indexes only).

-- uq_fee_concessions_source_disbursement_invoice
DO $drop_invalid_uq_fee_concessions_source_disbursement_invoice$
BEGIN
  IF EXISTS (
    SELECT 1
      FROM pg_class c
      JOIN pg_namespace n ON n.oid = c.relnamespace
      JOIN pg_index i ON i.indexrelid = c.oid
     WHERE n.nspname = 'public'
       AND c.relname = 'uq_fee_concessions_source_disbursement_invoice'
       AND NOT i.indisvalid
  ) THEN
    RAISE NOTICE 'dropping invalid uq_fee_concessions_source_disbursement_invoice before rebuild';
    EXECUTE 'DROP INDEX IF EXISTS public.uq_fee_concessions_source_disbursement_invoice';
  END IF;
END
$drop_invalid_uq_fee_concessions_source_disbursement_invoice$;

CREATE UNIQUE INDEX CONCURRENTLY IF NOT EXISTS uq_fee_concessions_source_disbursement_invoice
  ON fee_concessions (tenant_id, source_disbursement_id, invoice_id)
  WHERE source_disbursement_id IS NOT NULL AND invoice_id IS NOT NULL;

DO $assert_uq_fee_concessions_source_disbursement_invoice$
BEGIN
  IF NOT EXISTS (
    SELECT 1
      FROM pg_class c
      JOIN pg_namespace n ON n.oid = c.relnamespace
      JOIN pg_index i ON i.indexrelid = c.oid
     WHERE n.nspname = 'public'
       AND c.relname = 'uq_fee_concessions_source_disbursement_invoice'
       AND i.indrelid = 'public.fee_concessions'::regclass
       AND i.indisvalid
       AND i.indisunique
       AND i.indnkeyatts = 3
  ) THEN
    RAISE EXCEPTION 'F-D2: uq_fee_concessions_source_disbursement_invoice missing or not valid/unique';
  END IF;
END
$assert_uq_fee_concessions_source_disbursement_invoice$;

-- uq_fee_concessions_source_disbursement_reserved
DO $drop_invalid_uq_fee_concessions_source_disbursement_reserved$
BEGIN
  IF EXISTS (
    SELECT 1
      FROM pg_class c
      JOIN pg_namespace n ON n.oid = c.relnamespace
      JOIN pg_index i ON i.indexrelid = c.oid
     WHERE n.nspname = 'public'
       AND c.relname = 'uq_fee_concessions_source_disbursement_reserved'
       AND NOT i.indisvalid
  ) THEN
    RAISE NOTICE 'dropping invalid uq_fee_concessions_source_disbursement_reserved before rebuild';
    EXECUTE 'DROP INDEX IF EXISTS public.uq_fee_concessions_source_disbursement_reserved';
  END IF;
END
$drop_invalid_uq_fee_concessions_source_disbursement_reserved$;

CREATE UNIQUE INDEX CONCURRENTLY IF NOT EXISTS uq_fee_concessions_source_disbursement_reserved
  ON fee_concessions (tenant_id, source_disbursement_id)
  WHERE source_disbursement_id IS NOT NULL AND invoice_id IS NULL;

DO $assert_uq_fee_concessions_source_disbursement_reserved$
BEGIN
  IF NOT EXISTS (
    SELECT 1
      FROM pg_class c
      JOIN pg_namespace n ON n.oid = c.relnamespace
      JOIN pg_index i ON i.indexrelid = c.oid
     WHERE n.nspname = 'public'
       AND c.relname = 'uq_fee_concessions_source_disbursement_reserved'
       AND i.indrelid = 'public.fee_concessions'::regclass
       AND i.indisvalid
       AND i.indisunique
       AND i.indnkeyatts = 2
  ) THEN
    RAISE EXCEPTION 'F-D2: uq_fee_concessions_source_disbursement_reserved missing or not valid/unique';
  END IF;
END
$assert_uq_fee_concessions_source_disbursement_reserved$;

-- Both replacements are valid: drop the one-row-per-disbursement index.
DROP INDEX CONCURRENTLY IF EXISTS public.uq_fee_concessions_tenant_source_disbursement;
