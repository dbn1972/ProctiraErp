-- PRC-L529: PgWorkflowUiStore.decideApproval (the unmounted fallback store in
-- apps/api-gateway; the engine-backed path records the actor on the
-- transition) SELECTed the approval, then DELETEd it and updated the instance,
-- so the decision and who made it were lost. workflow_ui_approvals (019) had
-- no decision columns.
--
--   decision    TEXT         'APPROVED' | 'REJECTED' (the values the store and
--                             the UI API already use; workflow_ui_instances.status
--                             uses the same upper-case vocabulary)
--   decided_by  TEXT         JWT subject of the approver
--   decided_at  TIMESTAMPTZ  NULL = pending
-- decideApproval now UPDATEs the pending row (WHERE decided_at IS NULL) and
-- pending lists filter decided_at IS NULL.
--
-- Nullable adds are metadata-only. The CHECK is added NOT VALID and validated
-- with FORCE RLS lifted and restored in this same transaction (W1-DATA-18; a
-- FORCE-RLS validation scan would otherwise see zero rows). The table is tiny
-- (demo/fallback UI rows), so the ACCESS EXCLUSIVE of the FORCE toggle is brief.
-- Invariant: decision IS NULL OR decision IN ('APPROVED','REJECTED').
-- Rollback (future forward migration):
--   ALTER TABLE workflow_ui_approvals DROP CONSTRAINT IF EXISTS workflow_ui_approvals_decision_chk,
--     DROP COLUMN IF EXISTS decided_at, DROP COLUMN IF EXISTS decided_by,
--     DROP COLUMN IF EXISTS decision;
ALTER TABLE workflow_ui_approvals
  ADD COLUMN IF NOT EXISTS decision TEXT,
  ADD COLUMN IF NOT EXISTS decided_by TEXT,
  ADD COLUMN IF NOT EXISTS decided_at TIMESTAMPTZ;
DO $l529_check$
DECLARE
  was_forced boolean;
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint
     WHERE conrelid = 'public.workflow_ui_approvals'::regclass
       AND conname = 'workflow_ui_approvals_decision_chk'
  ) THEN
    ALTER TABLE workflow_ui_approvals
      ADD CONSTRAINT workflow_ui_approvals_decision_chk
      CHECK (decision IS NULL OR decision IN ('APPROVED', 'REJECTED')) NOT VALID;
  END IF;
  SELECT relforcerowsecurity INTO was_forced
    FROM pg_class WHERE oid = 'public.workflow_ui_approvals'::regclass;
  IF was_forced THEN
    ALTER TABLE workflow_ui_approvals NO FORCE ROW LEVEL SECURITY;
  END IF;
  ALTER TABLE workflow_ui_approvals VALIDATE CONSTRAINT workflow_ui_approvals_decision_chk;
  IF was_forced THEN
    ALTER TABLE workflow_ui_approvals FORCE ROW LEVEL SECURITY;
  END IF;
END
$l529_check$;
