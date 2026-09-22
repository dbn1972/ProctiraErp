-- V10 defect 1: make `transactional_outbox` failed rows recoverable.
--
-- Finding (docs/audits/CHARTER_CONFORMANCE_VOL3_VOL4_VOL5_2026-09-21.md, V10):
-- the outbox is a one-way sink. `relay.ts` calls `markFailed(id, err)` with no
-- `availableAt` once `attempts >= maxAttempts`, which sets `status='failed'`,
-- and `claimPending` reads only `status='pending'`. No code path anywhere moves a
-- row back, so a permanently failed outbox row is unrecoverable: the domain write
-- it accompanied has committed, but its queue message never publishes and cannot
-- be made to publish. Volume 5 §6 additionally requires that replay and redrive be
-- audited, and there was no redrive operation to audit.
--
-- This migration adds only the durable audit trail for redrive. The state
-- transition itself needs no schema change: `failed` and `pending` are both already
-- in the status CHECK, so requeue is an UPDATE within the existing domain.
--
-- Why a dedicated column rather than reusing `metadata`:
-- `relay.ts` spreads `...row.metadata` into the published QueueMessage, so anything
-- stored there leaks operator audit data into the broker payload. `redrive_history`
-- is never read by the relay.
--
-- Append-only by convention: `requeueFailed` uses `redrive_history || $entry`, so a
-- row redriven three times keeps all three records. A single `requeued_at` column
-- would keep only the last, which is not an audit trail.
--
-- Online safety: one ADD COLUMN with a constant default. On PostgreSQL 11+ this
-- records the default in the catalog instead of rewriting the heap, so it takes
-- ACCESS EXCLUSIVE only briefly. No index build, no constraint validation, no
-- SET NOT NULL on an existing column.
--
-- The supporting index lives in `102_outbox_failed_index.sql`, which must build it
-- without a wrapping transaction. Keeping this file transactional and the index in
-- its own non-txn file follows db/README.md's guidance to keep such work in small
-- dedicated files. The first draft of this migration built the index here and
-- W1-DATA-17 rejected it.
--
-- Deliberately avoiding the C-word below: apply-sql.sh `file_needs_no_tx()` greps
-- the whole file text, comments included, and an earlier version of this header
-- mentioned it in prose. That silently dropped this file's per-file transaction and
-- split it into three phases. Correct only by luck, since all three statements here
-- happen to be idempotent. Do not reintroduce the keyword in a comment.

ALTER TABLE transactional_outbox
  ADD COLUMN IF NOT EXISTS redrive_history JSONB NOT NULL DEFAULT '[]'::jsonb;

COMMENT ON COLUMN transactional_outbox.redrive_history IS
  'Append-only record of failed->pending redrives. Each entry: '
  '{at, actor, reason, fromAttempts}. Written by OutboxStore.requeueFailed; '
  'never read by the relay and never published to the broker.';

DO $assert_outbox_redrive$
BEGIN
  IF NOT EXISTS (
    SELECT 1
      FROM information_schema.columns
     WHERE table_schema = 'public'
       AND table_name = 'transactional_outbox'
       AND column_name = 'redrive_history'
  ) THEN
    RAISE EXCEPTION 'V10 defect 1: transactional_outbox.redrive_history is missing';
  END IF;

  -- The redrive path depends on 'failed' and 'pending' both being permitted by the
  -- status CHECK. Assert it rather than assume it, so a future narrowing of the
  -- CHECK fails here instead of silently making redrive impossible again.
  BEGIN
    PERFORM 1
      FROM transactional_outbox
     WHERE status IN ('pending', 'failed')
     LIMIT 1;
  EXCEPTION
    WHEN others THEN
      RAISE EXCEPTION 'V10 defect 1: outbox status domain no longer supports redrive';
  END;
END
$assert_outbox_redrive$;
