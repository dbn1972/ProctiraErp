-- PRC-L056: persist the approver's reason on a staff leave decision.
--
-- staff_leave_requests (013) stores the applicant's `reason` but nothing for the
-- decision, so the leave decision UI cannot capture or show why a request was
-- rejected. Adds a nullable decision_reason (max 1000 chars, not blank when set).
--
-- Data safety: ADD COLUMN without a default is metadata-only (no rewrite). The
-- CHECK is added NOT VALID and validated in the same file; every existing row
-- has decision_reason NULL, so validation cannot fail. RLS (015 tenant_isolation,
-- ENABLE + FORCE) and the dml privilege class already cover the new column.
-- Idempotent.
--
-- Rollback: forward-only; a later migration may DROP COLUMN decision_reason
-- (drops any captured reasons).
ALTER TABLE staff_leave_requests ADD COLUMN IF NOT EXISTS decision_reason TEXT;

ALTER TABLE staff_leave_requests DROP CONSTRAINT IF EXISTS staff_leave_requests_decision_reason_check;
ALTER TABLE staff_leave_requests
  ADD CONSTRAINT staff_leave_requests_decision_reason_check
  CHECK (
    decision_reason IS NULL
    OR (length(btrim(decision_reason)) > 0 AND length(decision_reason) <= 1000)
  ) NOT VALID;
-- FORCE RLS would make the owner's validation scan see zero rows; lift it for
-- the scan and restore it in the same transaction (db/sql/100 pattern).
ALTER TABLE staff_leave_requests NO FORCE ROW LEVEL SECURITY;
ALTER TABLE staff_leave_requests VALIDATE CONSTRAINT staff_leave_requests_decision_reason_check;
ALTER TABLE staff_leave_requests FORCE ROW LEVEL SECURITY;

COMMENT ON COLUMN staff_leave_requests.decision_reason IS
  'PRC-L056: approver-supplied reason for the approve/reject decision (rejections should set it).';
