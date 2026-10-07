-- PRC-H108: at most one transport fee link per (tenant, assignment).
--
-- TransportService.linkTransportFee guards with findFeeLinkByAssignment before
-- creating a link, but that is a check-then-insert across separate statements,
-- so two concurrent student-assignment creations (double-click, retry, second
-- replica) could each pass the guard and create two links — and, via the
-- bulkInvoiceClass `skipped` fallthrough, two Fees invoices for one student.
--
-- The service fix stops the double invoice (skipped is no longer treated as
-- "create another"); this unique index is the DB backstop so a concurrent
-- duplicate link raises 23505 and the second create rolls back rather than
-- billing the student twice.
--
-- transport_fee_links is a tenant table already under ENABLE + FORCE ROW LEVEL
-- SECURITY with a tenant_isolation policy (db/sql/045). This migration only adds
-- a unique index; it does not change RLS.
--
-- W1-DATA-17: building the unique index with CREATE UNIQUE INDEX (plain) takes
-- an ACCESS EXCLUSIVE lock for the whole build, which can queue behind app
-- traffic. Build it CONCURRENTLY instead so writers are not blocked. Because
-- CONCURRENTLY cannot run inside a transaction, this is a non-transactional file
-- (apply-sql.sh detects the CONCURRENTLY keyword and applies it statement-by-
-- statement via the schema_migration_phases ledger). Every statement below is
-- idempotent compensating-forward DDL, per db/README.md, because a crash between
-- a statement commit and its phase-ledger row re-runs the statement. apply-sql.sh
-- records schema_migrations after the file completes, so there is no
-- INSERT INTO schema_migrations line here (same as db/sql/102).
--
-- Data safety: existing duplicates are NOT deleted (links may reference money
-- invoices). The preflight fails the apply with a count so an operator can
-- reconcile first. A new database has none.
-- Rollback: forward-only; a later migration may drop the index to relax.

-- 1) Preflight: refuse to build over duplicates. Under FORCE ROW LEVEL SECURITY
--    the owner scan sees zero rows without app.tenant_id, so lift FORCE for the
--    count and restore it in the same block (atomic DO block — a failure cannot
--    leave the table unforced).
DO $h108_preflight$
DECLARE
  was_forced boolean;
  duplicate_groups bigint;
BEGIN
  IF to_regclass('public.transport_fee_links') IS NULL THEN
    RAISE NOTICE 'PRC-H108: transport_fee_links missing; skipping';
    RETURN;
  END IF;
  SELECT relforcerowsecurity INTO was_forced
    FROM pg_class WHERE oid = 'public.transport_fee_links'::regclass;
  IF was_forced THEN
    ALTER TABLE transport_fee_links NO FORCE ROW LEVEL SECURITY;
  END IF;
  SELECT count(*) INTO duplicate_groups
    FROM (
      SELECT 1
        FROM transport_fee_links
       GROUP BY tenant_id, assignment_id
      HAVING count(*) > 1
    ) d;
  IF was_forced THEN
    ALTER TABLE transport_fee_links FORCE ROW LEVEL SECURITY;
  END IF;
  IF duplicate_groups > 0 THEN
    RAISE EXCEPTION
      'PRC-H108: % assignment(s) already have more than one transport fee link; '
      'reconcile them (cancel the extra link/invoice) before re-running',
      duplicate_groups;
  END IF;
END
$h108_preflight$;

-- 2) A CONCURRENTLY build that is interrupted leaves an INVALID index behind.
--    `IF NOT EXISTS` would then skip it forever and the index would never become
--    usable, so drop any invalid leftover before rebuilding. This is the resume
--    path, not a normal one. The DROP is deliberately NOT CONCURRENTLY: Postgres
--    rejects DROP INDEX CONCURRENTLY inside a DO block, and a plain DROP of an
--    INVALID index is safe (the planner does not use it). The condition matters —
--    an unconditional drop would discard a healthy index on every re-apply.
DO $drop_invalid_transport_fee_links_uidx$
BEGIN
  IF EXISTS (
    SELECT 1
      FROM pg_class c
      JOIN pg_namespace n ON n.oid = c.relnamespace
      JOIN pg_index i ON i.indexrelid = c.oid
     WHERE n.nspname = 'public'
       AND c.relname = 'transport_fee_links_assignment_uidx'
       AND NOT i.indisvalid
  ) THEN
    RAISE NOTICE 'dropping invalid transport_fee_links_assignment_uidx before rebuild';
    EXECUTE 'DROP INDEX IF EXISTS public.transport_fee_links_assignment_uidx';
  END IF;
END
$drop_invalid_transport_fee_links_uidx$;

-- 3) The unique index, built CONCURRENTLY. Replaces reliance on the non-unique
--    transport_fee_links_assignment_idx for duplicate prevention.
CREATE UNIQUE INDEX CONCURRENTLY IF NOT EXISTS transport_fee_links_assignment_uidx
  ON transport_fee_links (tenant_id, assignment_id);

-- 4) Present AND valid AND unique, or fail the apply.
DO $h108_assert$
BEGIN
  IF to_regclass('public.transport_fee_links') IS NULL THEN
    RETURN;
  END IF;
  IF NOT EXISTS (
    SELECT 1
      FROM pg_class c
      JOIN pg_namespace n ON n.oid = c.relnamespace
      JOIN pg_index i ON i.indexrelid = c.oid
     WHERE n.nspname = 'public'
       AND c.relname = 'transport_fee_links_assignment_uidx'
       AND i.indisvalid
       AND i.indisunique
  ) THEN
    RAISE EXCEPTION 'PRC-H108: transport_fee_links_assignment_uidx missing or not valid/unique';
  END IF;
END
$h108_assert$;

COMMENT ON INDEX transport_fee_links_assignment_uidx IS
  'PRC-H108 one fee link per (tenant, assignment); backstops the double-invoice guard.';
