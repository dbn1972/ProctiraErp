-- PRC-M204 — dual control and PII purge on privacy correction / erasure requests.
--
-- privacy_erasure_requests (067) and privacy_correction_requests (078) keep
-- one reviewed_by column that every transition overwrites, and nothing in the
-- database stops the requester from approving their own request. Correction
-- requests also keep the raw current/requested values after a request is
-- rejected or cancelled (only `applied` was redacted, by the service,
-- PRC-M322).
--
-- Fix:
--   1. Preflight: count `approved` requests whose reviewer is the requester
--      (a self-approval already on disk). Any such row stops the migration
--      with the counts; cancel or re-review them first. Nothing is changed
--      automatically.
--   2. approved_by TEXT on both tables: who approved the request. Backfilled
--      from reviewed_by for rows that are `approved` now (the reviewer of an
--      approved row is its approver). Older rows past approval keep NULL
--      (the approver is not recoverable from reviewed_by).
--   3. BEFORE INSERT OR UPDATE trigger privacy_request_stamp_approver():
--      when a row enters `approved` from a review state (erasure:
--      requested / under_review / blocked_legal_hold; correction: any other
--      status) approved_by := reviewed_by. The database derives the approver,
--      so no code path can skip it. Erasure in_progress -> approved (retry
--      after a failed run, release of a stalled run) keeps the approval.
--   4. CHECK (approved_by IS NULL OR approved_by <> requested_by) on both
--      tables: a self-approval is rejected (23514). Added NOT VALID, then
--      VALIDATE (no legacy violation can exist after the preflight).
--   5. Correction PII purge: rows in a terminal status (applied / rejected /
--      cancelled) keep no raw value: current_value NULL, requested_value
--      '[REDACTED]' (CORRECTION_VALUE_REDACTED). Legacy terminal rows are
--      redacted here, then CHECK privacy_correction_terminal_redacted
--      (NOT VALID + VALIDATE). The audit trail keeps only value digests
--      (PRC-M322), so nothing else changes.
--
-- RLS: both tables are FORCE RLS with a tenant-only policy, so the migrator
-- would see no rows. As in 098/100, FORCE is lifted for the preflight,
-- backfill and VALIDATE inside this file's transaction and restored before it
-- commits.
--
-- Rollback (future forward migration):
--   ALTER TABLE privacy_erasure_requests DROP CONSTRAINT privacy_erasure_approver_distinct;
--   ALTER TABLE privacy_correction_requests DROP CONSTRAINT privacy_correction_approver_distinct;
--   ALTER TABLE privacy_correction_requests DROP CONSTRAINT privacy_correction_terminal_redacted;
--   DROP TRIGGER trg_privacy_erasure_stamp_approver ON privacy_erasure_requests;
--   DROP TRIGGER trg_privacy_correction_stamp_approver ON privacy_correction_requests;
--   DROP FUNCTION privacy_request_stamp_approver();
--   (approved_by columns may stay; they are nullable.) Redacted values are
--   not restorable.

ALTER TABLE privacy_erasure_requests ADD COLUMN IF NOT EXISTS approved_by TEXT;
ALTER TABLE privacy_correction_requests ADD COLUMN IF NOT EXISTS approved_by TEXT;

COMMENT ON COLUMN privacy_erasure_requests.approved_by IS
  'PRC-M204: actor who approved the request (set by trg_privacy_erasure_stamp_approver); never the requester.';
COMMENT ON COLUMN privacy_correction_requests.approved_by IS
  'PRC-M204: actor who approved the request (set by trg_privacy_correction_stamp_approver); never the requester.';

DO $m204$
DECLARE
  v_erasure_forced boolean;
  v_correction_forced boolean;
  v_self_erasure bigint;
  v_self_correction bigint;
BEGIN
  SELECT relforcerowsecurity INTO v_erasure_forced
    FROM pg_class WHERE oid = 'public.privacy_erasure_requests'::regclass;
  SELECT relforcerowsecurity INTO v_correction_forced
    FROM pg_class WHERE oid = 'public.privacy_correction_requests'::regclass;
  IF v_erasure_forced THEN
    ALTER TABLE privacy_erasure_requests NO FORCE ROW LEVEL SECURITY;
  END IF;
  IF v_correction_forced THEN
    ALTER TABLE privacy_correction_requests NO FORCE ROW LEVEL SECURITY;
  END IF;

  SELECT count(*) INTO v_self_erasure
    FROM privacy_erasure_requests
   WHERE status = 'approved' AND reviewed_by = requested_by;
  SELECT count(*) INTO v_self_correction
    FROM privacy_correction_requests
   WHERE status = 'approved' AND reviewed_by = requested_by;
  IF v_self_erasure > 0 OR v_self_correction > 0 THEN
    RAISE EXCEPTION
      'PRC-M204 preflight: % erasure and % correction request(s) are approved by their own requester; cancel or re-review them, then re-run',
      v_self_erasure, v_self_correction
      USING ERRCODE = 'check_violation';
  END IF;

  UPDATE privacy_erasure_requests
     SET approved_by = reviewed_by
   WHERE status = 'approved' AND approved_by IS NULL AND reviewed_by IS NOT NULL;
  UPDATE privacy_correction_requests
     SET approved_by = reviewed_by
   WHERE status = 'approved' AND approved_by IS NULL AND reviewed_by IS NOT NULL;
  UPDATE privacy_correction_requests
     SET current_value = NULL, requested_value = '[REDACTED]', updated_at = now()
   WHERE status IN ('applied', 'rejected', 'cancelled')
     AND (current_value IS NOT NULL OR requested_value <> '[REDACTED]');

  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'privacy_erasure_approver_distinct') THEN
    ALTER TABLE privacy_erasure_requests
      ADD CONSTRAINT privacy_erasure_approver_distinct
      CHECK (approved_by IS NULL OR approved_by <> requested_by) NOT VALID;
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'privacy_correction_approver_distinct') THEN
    ALTER TABLE privacy_correction_requests
      ADD CONSTRAINT privacy_correction_approver_distinct
      CHECK (approved_by IS NULL OR approved_by <> requested_by) NOT VALID;
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'privacy_correction_terminal_redacted') THEN
    ALTER TABLE privacy_correction_requests
      ADD CONSTRAINT privacy_correction_terminal_redacted
      CHECK (
        status NOT IN ('applied', 'rejected', 'cancelled')
        OR (current_value IS NULL AND requested_value = '[REDACTED]')
      ) NOT VALID;
  END IF;
  ALTER TABLE privacy_erasure_requests VALIDATE CONSTRAINT privacy_erasure_approver_distinct;
  ALTER TABLE privacy_correction_requests VALIDATE CONSTRAINT privacy_correction_approver_distinct;
  ALTER TABLE privacy_correction_requests VALIDATE CONSTRAINT privacy_correction_terminal_redacted;

  IF v_erasure_forced THEN
    ALTER TABLE privacy_erasure_requests FORCE ROW LEVEL SECURITY;
  END IF;
  IF v_correction_forced THEN
    ALTER TABLE privacy_correction_requests FORCE ROW LEVEL SECURITY;
  END IF;
END
$m204$;

CREATE OR REPLACE FUNCTION privacy_request_stamp_approver()
RETURNS trigger
LANGUAGE plpgsql
SET search_path = public, pg_temp
AS $$
BEGIN
  IF NEW.status = 'approved' AND (
       TG_OP = 'INSERT'
       OR (TG_TABLE_NAME = 'privacy_erasure_requests'
           AND OLD.status IN ('requested', 'under_review', 'blocked_legal_hold'))
       OR (TG_TABLE_NAME = 'privacy_correction_requests'
           AND OLD.status IS DISTINCT FROM 'approved')
     ) THEN
    NEW.approved_by := NEW.reviewed_by;
  END IF;
  RETURN NEW;
END;
$$;

COMMENT ON FUNCTION privacy_request_stamp_approver() IS
  'PRC-M204: approved_by := reviewed_by when a privacy request enters approved from review (erasure retry/release keeps the approval).';

DROP TRIGGER IF EXISTS trg_privacy_erasure_stamp_approver ON privacy_erasure_requests;
CREATE TRIGGER trg_privacy_erasure_stamp_approver
  BEFORE INSERT OR UPDATE OF status ON privacy_erasure_requests
  FOR EACH ROW EXECUTE FUNCTION privacy_request_stamp_approver();

DROP TRIGGER IF EXISTS trg_privacy_correction_stamp_approver ON privacy_correction_requests;
CREATE TRIGGER trg_privacy_correction_stamp_approver
  BEFORE INSERT OR UPDATE OF status ON privacy_correction_requests
  FOR EACH ROW EXECUTE FUNCTION privacy_request_stamp_approver();
