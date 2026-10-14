-- PRC-M362 supporting index. Separate file because CREATE INDEX CONCURRENTLY
-- cannot run inside a transaction; apply-sql.sh detects the CONCURRENTLY keyword
-- and applies this file statement-by-statement with schema_migration_phases.
--
-- claimPending reclaims expired leases with
--   WHERE status = 'processing' AND locked_until <= now()
-- so a partial index on locked_until for processing rows keeps the reclaim scan
-- off the heap. Every statement is idempotent compensating-forward DDL.

-- Drop any INVALID leftover from an interrupted build before rebuilding.
DO $drop_invalid_outbox_lease_idx$
BEGIN
  IF EXISTS (
    SELECT 1
      FROM pg_class c
      JOIN pg_namespace n ON n.oid = c.relnamespace
      JOIN pg_index i ON i.indexrelid = c.oid
     WHERE n.nspname = 'public'
       AND c.relname = 'transactional_outbox_lease_idx'
       AND NOT i.indisvalid
  ) THEN
    RAISE NOTICE 'dropping invalid transactional_outbox_lease_idx before rebuild';
    EXECUTE 'DROP INDEX IF EXISTS public.transactional_outbox_lease_idx';
  END IF;
END
$drop_invalid_outbox_lease_idx$;

CREATE INDEX CONCURRENTLY IF NOT EXISTS transactional_outbox_lease_idx
  ON transactional_outbox (locked_until)
  WHERE status = 'processing';

DO $assert_outbox_lease_idx$
BEGIN
  IF NOT EXISTS (
    SELECT 1
      FROM pg_class c
      JOIN pg_namespace n ON n.oid = c.relnamespace
      JOIN pg_index i ON i.indexrelid = c.oid
     WHERE n.nspname = 'public'
       AND c.relname = 'transactional_outbox_lease_idx'
       AND i.indisvalid
  ) THEN
    RAISE EXCEPTION
      'PRC-M362: transactional_outbox_lease_idx missing or INVALID';
  END IF;
END
$assert_outbox_lease_idx$;
