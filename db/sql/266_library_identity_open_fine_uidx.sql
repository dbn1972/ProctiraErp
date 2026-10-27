-- PRC-L130: library_items had no per-tenant uniqueness on isbn (009) or the
-- item-level barcode (039 ADD COLUMN barcode, no unique; only copies are
-- unique, 039:31). A duplicate create or a repeated ISBN import landed a
-- second catalog row for the same book.
--
--   library_items_tenant_isbn_uidx    (tenant_id, isbn)    WHERE isbn <> ''
--   library_items_tenant_barcode_uidx (tenant_id, barcode) WHERE barcode <> ''
-- NULL and empty values are unconstrained (items without an ISBN/barcode).
-- create/import normalise the ISBN (isbn-lookup normalizeIsbn) before insert,
-- and the repository maps 23505 to ConflictError (409). Existing rows are not
-- rewritten: a legacy hyphenated ISBN stays as stored (the 009b seed has two
-- distinct ISBNs, so the preflight passes on CI/seeded databases).
--
-- Shape (246/253): per table, preflight duplicate count with FORCE RLS lifted
-- and restored inside one DO block (each DO is its own transaction in a
-- CONCURRENTLY file), RAISE on duplicates (never delete data); drop an INVALID
-- leftover; CREATE UNIQUE INDEX CONCURRENTLY IF NOT EXISTS; assert valid +
-- unique. Every statement is idempotent; applied statement-by-statement via
-- schema_migration_phases.
-- Rollback (future forward migration):
--   DROP INDEX IF EXISTS library_items_tenant_isbn_uidx;
--   DROP INDEX IF EXISTS library_items_tenant_barcode_uidx;
--   DROP INDEX IF EXISTS library_fines_open_per_loan_uidx;
--
-- PRC-M206 (a): assessFine checked findOpenFineForLoan and then inserted, so
-- two concurrent assessments of one overdue loan created two open fines.
--   library_fines_open_per_loan_uidx (tenant_id, loan_id) WHERE status = 'open'
-- mirrors the app rule exactly (one OPEN fine per loan; paid/waived fines do
-- not block a later one). A plain UNIQUE (loan_id) would be a new business
-- rule. The repository maps its 23505 to ConflictError. Residual (finance,
-- BLOCKED_FOR_APPROVAL): assessFine posts the fee-ledger invoice before the
-- fine insert; reordering that posting flow is out of scope here.
DO $l130_isbn_preflight$
DECLARE
  was_forced boolean;
  duplicate_groups bigint;
BEGIN
  SELECT relforcerowsecurity INTO was_forced FROM pg_class WHERE oid = 'public.library_items'::regclass;
  IF was_forced THEN
    ALTER TABLE library_items NO FORCE ROW LEVEL SECURITY;
  END IF;
  SELECT count(*) INTO duplicate_groups
    FROM (
      SELECT tenant_id, isbn FROM library_items
       WHERE isbn <> ''
       GROUP BY tenant_id, isbn
      HAVING count(*) > 1
    ) d;
  IF was_forced THEN
    ALTER TABLE library_items FORCE ROW LEVEL SECURITY;
  END IF;
  IF duplicate_groups > 0 THEN
    RAISE EXCEPTION
      'PRC-L130: % duplicate library_items group(s) on (tenant_id, isbn) WHERE isbn <> ''''; reconcile before re-running',
      duplicate_groups;
  END IF;
END
$l130_isbn_preflight$;
DO $l130_barcode_preflight$
DECLARE
  was_forced boolean;
  duplicate_groups bigint;
BEGIN
  SELECT relforcerowsecurity INTO was_forced FROM pg_class WHERE oid = 'public.library_items'::regclass;
  IF was_forced THEN
    ALTER TABLE library_items NO FORCE ROW LEVEL SECURITY;
  END IF;
  SELECT count(*) INTO duplicate_groups
    FROM (
      SELECT tenant_id, barcode FROM library_items
       WHERE barcode <> ''
       GROUP BY tenant_id, barcode
      HAVING count(*) > 1
    ) d;
  IF was_forced THEN
    ALTER TABLE library_items FORCE ROW LEVEL SECURITY;
  END IF;
  IF duplicate_groups > 0 THEN
    RAISE EXCEPTION
      'PRC-L130: % duplicate library_items group(s) on (tenant_id, barcode) WHERE barcode <> ''''; reconcile before re-running',
      duplicate_groups;
  END IF;
END
$l130_barcode_preflight$;
DO $l130_drop_invalid_isbn$
BEGIN
  IF EXISTS (
    SELECT 1
      FROM pg_class c
      JOIN pg_namespace n ON n.oid = c.relnamespace
      JOIN pg_index i ON i.indexrelid = c.oid
     WHERE n.nspname = 'public'
       AND c.relname = 'library_items_tenant_isbn_uidx'
       AND NOT i.indisvalid
  ) THEN
    RAISE NOTICE 'dropping invalid library_items_tenant_isbn_uidx before rebuild';
    EXECUTE 'DROP INDEX IF EXISTS public.library_items_tenant_isbn_uidx';
  END IF;
END
$l130_drop_invalid_isbn$;
CREATE UNIQUE INDEX CONCURRENTLY IF NOT EXISTS library_items_tenant_isbn_uidx
  ON library_items (tenant_id, isbn)
  WHERE isbn <> '';
DO $l130_assert_isbn$
BEGIN
  IF NOT EXISTS (
    SELECT 1
      FROM pg_class c
      JOIN pg_namespace n ON n.oid = c.relnamespace
      JOIN pg_index i ON i.indexrelid = c.oid
     WHERE n.nspname = 'public'
       AND c.relname = 'library_items_tenant_isbn_uidx'
       AND i.indisvalid
       AND i.indisunique
  ) THEN
    RAISE EXCEPTION 'PRC-L130: library_items_tenant_isbn_uidx missing or INVALID';
  END IF;
END
$l130_assert_isbn$;
DO $l130_drop_invalid_barcode$
BEGIN
  IF EXISTS (
    SELECT 1
      FROM pg_class c
      JOIN pg_namespace n ON n.oid = c.relnamespace
      JOIN pg_index i ON i.indexrelid = c.oid
     WHERE n.nspname = 'public'
       AND c.relname = 'library_items_tenant_barcode_uidx'
       AND NOT i.indisvalid
  ) THEN
    RAISE NOTICE 'dropping invalid library_items_tenant_barcode_uidx before rebuild';
    EXECUTE 'DROP INDEX IF EXISTS public.library_items_tenant_barcode_uidx';
  END IF;
END
$l130_drop_invalid_barcode$;
CREATE UNIQUE INDEX CONCURRENTLY IF NOT EXISTS library_items_tenant_barcode_uidx
  ON library_items (tenant_id, barcode)
  WHERE barcode <> '';
DO $l130_assert_barcode$
BEGIN
  IF NOT EXISTS (
    SELECT 1
      FROM pg_class c
      JOIN pg_namespace n ON n.oid = c.relnamespace
      JOIN pg_index i ON i.indexrelid = c.oid
     WHERE n.nspname = 'public'
       AND c.relname = 'library_items_tenant_barcode_uidx'
       AND i.indisvalid
       AND i.indisunique
  ) THEN
    RAISE EXCEPTION 'PRC-L130: library_items_tenant_barcode_uidx missing or INVALID';
  END IF;
END
$l130_assert_barcode$;
DO $m206_fines_preflight$
DECLARE
  was_forced boolean;
  duplicate_groups bigint;
BEGIN
  SELECT relforcerowsecurity INTO was_forced FROM pg_class WHERE oid = 'public.library_fines'::regclass;
  IF was_forced THEN
    ALTER TABLE library_fines NO FORCE ROW LEVEL SECURITY;
  END IF;
  SELECT count(*) INTO duplicate_groups
    FROM (
      SELECT tenant_id, loan_id FROM library_fines
       WHERE status = 'open'
       GROUP BY tenant_id, loan_id
      HAVING count(*) > 1
    ) d;
  IF was_forced THEN
    ALTER TABLE library_fines FORCE ROW LEVEL SECURITY;
  END IF;
  IF duplicate_groups > 0 THEN
    RAISE EXCEPTION
      'PRC-M206: % loan(s) already have more than one open library fine; reconcile before re-running',
      duplicate_groups;
  END IF;
END
$m206_fines_preflight$;
DO $m206_drop_invalid_fines$
BEGIN
  IF EXISTS (
    SELECT 1
      FROM pg_class c
      JOIN pg_namespace n ON n.oid = c.relnamespace
      JOIN pg_index i ON i.indexrelid = c.oid
     WHERE n.nspname = 'public'
       AND c.relname = 'library_fines_open_per_loan_uidx'
       AND NOT i.indisvalid
  ) THEN
    RAISE NOTICE 'dropping invalid library_fines_open_per_loan_uidx before rebuild';
    EXECUTE 'DROP INDEX IF EXISTS public.library_fines_open_per_loan_uidx';
  END IF;
END
$m206_drop_invalid_fines$;
CREATE UNIQUE INDEX CONCURRENTLY IF NOT EXISTS library_fines_open_per_loan_uidx
  ON library_fines (tenant_id, loan_id)
  WHERE status = 'open';
DO $m206_assert_fines$
BEGIN
  IF NOT EXISTS (
    SELECT 1
      FROM pg_class c
      JOIN pg_namespace n ON n.oid = c.relnamespace
      JOIN pg_index i ON i.indexrelid = c.oid
     WHERE n.nspname = 'public'
       AND c.relname = 'library_fines_open_per_loan_uidx'
       AND i.indisvalid
       AND i.indisunique
  ) THEN
    RAISE EXCEPTION 'PRC-M206: library_fines_open_per_loan_uidx missing or INVALID';
  END IF;
END
$m206_assert_fines$;
