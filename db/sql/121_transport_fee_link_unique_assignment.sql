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
-- Additive and idempotent (IF NOT EXISTS). Transactional DDL.
-- Data safety: existing duplicates are NOT deleted (links may reference money
-- invoices). The preflight fails the apply with a count so an operator can
-- reconcile first. A new database has none.
-- Rollback: forward-only; a later migration may drop the index to relax.

-- 1) Preflight: refuse to build over duplicates. Under FORCE ROW LEVEL SECURITY
--    the owner scan sees zero rows without app.tenant_id, so lift FORCE for the
--    count and restore it in the same block.
DO $h108_preflight$
DECLARE
  was_forced boolean;
  duplicate_groups bigint;
BEGIN
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

-- 2) The unique index. Replaces reliance on the non-unique
--    transport_fee_links_assignment_idx for duplicate prevention.
CREATE UNIQUE INDEX IF NOT EXISTS transport_fee_links_assignment_uidx
  ON transport_fee_links (tenant_id, assignment_id);

-- 3) Present AND unique, or fail the apply.
DO $h108_assert$
BEGIN
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
    RAISE EXCEPTION 'PRC-H108: transport_fee_links_assignment_uidx missing or not unique';
  END IF;
END
$h108_assert$;

COMMENT ON INDEX transport_fee_links_assignment_uidx IS
  'PRC-H108 one fee link per (tenant, assignment); backstops the double-invoice guard.';

INSERT INTO schema_migrations (filename)
VALUES ('121_transport_fee_link_unique_assignment.sql')
ON CONFLICT (filename) DO NOTHING;
