-- V10 defect 1, supporting index. Separate file because CREATE INDEX CONCURRENTLY
-- cannot run inside a transaction; apply-sql.sh detects the CONCURRENTLY keyword
-- and applies this file statement-by-statement with schema_migration_phases.
--
-- Operators list failed outbox rows per tenant before redriving them
-- (OutboxStore.listFailed). The existing `transactional_outbox_pending_idx` is a
-- partial index WHERE status = 'pending', so it does not serve this path, and
-- `transactional_outbox_tenant_idx` is unfiltered.
--
-- Every statement below must be idempotent compensating-forward DDL, per
-- db/README.md, because a crash between statement commit and phase-row insert
-- re-runs the statement.

-- A CONCURRENTLY build that is interrupted leaves an INVALID index behind.
-- `IF NOT EXISTS` would then skip it forever and the index would never become
-- usable, so drop any invalid leftover before rebuilding. This is the resume
-- path, not a normal one.
--
-- The drop is deliberately NOT `CONCURRENTLY`. Postgres rejects
-- `DROP INDEX CONCURRENTLY` inside a DO block ("cannot be executed from a
-- function"), which this file originally did and which failed on first test. A
-- plain DROP takes a brief ACCESS EXCLUSIVE lock, which is acceptable here: the
-- index being dropped is INVALID, so the planner is not using it, and this branch
-- only runs after an interrupted build. The condition matters — an unconditional
-- drop would discard a healthy index on every re-apply and leave a window with no
-- index at all.
DO $drop_invalid_outbox_failed_idx$
BEGIN
  IF EXISTS (
    SELECT 1
      FROM pg_class c
      JOIN pg_namespace n ON n.oid = c.relnamespace
      JOIN pg_index i ON i.indexrelid = c.oid
     WHERE n.nspname = 'public'
       AND c.relname = 'transactional_outbox_failed_idx'
       AND NOT i.indisvalid
  ) THEN
    RAISE NOTICE 'dropping invalid transactional_outbox_failed_idx before rebuild';
    EXECUTE 'DROP INDEX IF EXISTS public.transactional_outbox_failed_idx';
  END IF;
END
$drop_invalid_outbox_failed_idx$;

CREATE INDEX CONCURRENTLY IF NOT EXISTS transactional_outbox_failed_idx
  ON transactional_outbox (tenant_id, created_at DESC)
  WHERE status = 'failed';

DO $assert_outbox_failed_idx$
BEGIN
  -- Assert present AND valid. A merely-present index can still be INVALID, which
  -- the planner ignores, so checking pg_indexes alone would pass on a broken build.
  IF NOT EXISTS (
    SELECT 1
      FROM pg_class c
      JOIN pg_namespace n ON n.oid = c.relnamespace
      JOIN pg_index i ON i.indexrelid = c.oid
     WHERE n.nspname = 'public'
       AND c.relname = 'transactional_outbox_failed_idx'
       AND i.indisvalid
  ) THEN
    RAISE EXCEPTION
      'V10 defect 1: transactional_outbox_failed_idx missing or INVALID';
  END IF;
END
$assert_outbox_failed_idx$;
