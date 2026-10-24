-- PRC-M209: institution_repair_requests.status has no enforced lifecycle and
-- the runtime role has never been granted UPDATE on this table (db/sql/106
-- only granted SELECT, INSERT; db/runtime-table-privileges.json classifies it
-- "append_only", which grants SELECT+INSERT only). pg-store.ts's
-- updateRepairRequestStatus already handles the resulting 42501 as a
-- deliberate "not enabled yet" business-rule error (PRC-L124's comment), so
-- this migration closes the gap in two parts:
--
-- (A) a BEFORE UPDATE trigger that permits only the 'open'->'closed' and
--     'closed'->'open' transitions the application exposes (same-status
--     no-op updates are allowed; any other status value is rejected) -- a
--     DB-level backstop under the app-layer existing!=requested 409 check in
--     InfrastructureService.setRepairRequestStatus.
-- (B) a column-scoped GRANT UPDATE (status) to proctira_app so the UPDATE
--     this migration's own trigger governs can actually run; the runtime
--     role still cannot UPDATE any other column (summary, infrastructure_id,
--     institution_id, created_at, tenant_id all stay append-only).
--
-- db/runtime-table-privileges.json keeps its "append_only" classification
-- value unchanged -- that governs the generated base-grant sync in
-- tools/scripts/runtime-table-privileges-lib.mjs. The catalog's class values
-- are table-wide with no per-table notes field, so this column-scoped
-- exception is documented in db/README.md's "Column-scoped exceptions on
-- top of a class" section instead of in the JSON.
--
-- PRC-M209 reviewer flag: branch fix/partials-close-back2 (commit 850e48e0,
-- not an ancestor of main, different base history) already contains a more
-- complete event-sourced design for this exact finding (a dedicated
-- institution_repair_request_status_events table). This migration takes the
-- narrower status-transition-trigger + column-grant approach instead. A
-- reviewer should decide which design to prefer before merging — landing
-- both would conflict. See this feature's findings field / the PR body for
-- the full flag.
--
-- Rollback: forward-only; a later migration may REVOKE the column grant or
-- replace the trigger with the event-sourced design if that is preferred.

CREATE OR REPLACE FUNCTION institution_repair_requests_transition_guard()
RETURNS TRIGGER AS $$
BEGIN
  IF NEW.status = OLD.status THEN
    RETURN NEW;
  END IF;
  IF (OLD.status, NEW.status) IN (('open', 'closed'), ('closed', 'open')) THEN
    RETURN NEW;
  END IF;
  RAISE EXCEPTION
    'institution_repair_requests invalid status transition % -> %', OLD.status, NEW.status
    USING ERRCODE = 'integrity_constraint_violation';
END;
$$ LANGUAGE plpgsql;

DROP TRIGGER IF EXISTS trg_institution_repair_requests_transition_guard
  ON institution_repair_requests;
CREATE TRIGGER trg_institution_repair_requests_transition_guard
  BEFORE UPDATE ON institution_repair_requests
  FOR EACH ROW
  EXECUTE FUNCTION institution_repair_requests_transition_guard();

DO $$
BEGIN
  IF EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'proctira_app') THEN
    GRANT UPDATE (status) ON TABLE institution_repair_requests TO proctira_app;
  ELSE
    RAISE NOTICE 'PRC-M209: proctira_app missing — skip column-scoped UPDATE grant';
  END IF;
END $$;

COMMENT ON TABLE institution_repair_requests IS
  'PRC-M209 (db/sql/247): status transitions restricted to open<->closed by '
  'trg_institution_repair_requests_transition_guard. proctira_app holds a '
  'column-scoped GRANT UPDATE (status) added by 247 on top of the '
  'db/runtime-table-privileges.json "append_only" base class (SELECT, '
  'INSERT) -- the base class value is intentionally left unchanged; see 247 '
  'for the exception.';

INSERT INTO schema_migrations (filename)
VALUES ('247_institution_repair_request_transition_guard.sql')
ON CONFLICT (filename) DO NOTHING;
