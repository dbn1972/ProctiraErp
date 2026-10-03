-- PRC-L124: repair requests can be closed/reopened without granting UPDATE.
--
-- NEEDS DB REVIEW.
--
-- institution_repair_requests is append_only for proctira_app (SELECT, INSERT). Defaulted
-- decision (b): status changes are appended to institution_repair_request_status_events
-- (also append_only); the effective status of a request is the to_status of its highest
-- seq event, else the request's original status. Concurrent close/reopen of the same
-- request is serialised by UNIQUE (tenant_id, repair_request_id, seq): the loser's INSERT
-- fails with 23505 and the API answers 409.
--
-- Data safety: new empty table; no existing row is touched. Idempotent.
-- Rollback: forward-only (drop the table to return to open-only requests).
CREATE TABLE IF NOT EXISTS institution_repair_request_status_events (
  id UUID PRIMARY KEY,
  tenant_id UUID NOT NULL REFERENCES tenants(id),
  repair_request_id UUID NOT NULL
    REFERENCES institution_repair_requests(id) ON DELETE CASCADE,
  seq INTEGER NOT NULL CHECK (seq >= 1),
  from_status TEXT NOT NULL CHECK (from_status IN ('open', 'closed')),
  to_status TEXT NOT NULL CHECK (to_status IN ('open', 'closed')),
  changed_by TEXT CHECK (changed_by IS NULL OR length(changed_by) <= 200),
  changed_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  CONSTRAINT institution_repair_request_status_events_change_chk
    CHECK (from_status <> to_status),
  CONSTRAINT institution_repair_request_status_events_seq_uniq
    UNIQUE (tenant_id, repair_request_id, seq)
);

ALTER TABLE institution_repair_request_status_events ENABLE ROW LEVEL SECURITY;
ALTER TABLE institution_repair_request_status_events FORCE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS tenant_isolation ON institution_repair_request_status_events;
CREATE POLICY tenant_isolation ON institution_repair_request_status_events
  FOR ALL
  USING (tenant_id::text = NULLIF(current_setting('app.tenant_id', true), ''))
  WITH CHECK (tenant_id::text = NULLIF(current_setting('app.tenant_id', true), ''));

DO $l124_grants$
BEGIN
  IF EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'proctira_app') THEN
    REVOKE ALL ON institution_repair_request_status_events FROM proctira_app;
    GRANT SELECT, INSERT ON institution_repair_request_status_events TO proctira_app;
  ELSE
    RAISE NOTICE 'PRC-L124: proctira_app missing - grants applied by the catalog sync later';
  END IF;
END
$l124_grants$;
