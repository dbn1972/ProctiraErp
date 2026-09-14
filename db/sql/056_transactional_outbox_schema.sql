-- W2-JOB-04: transactional outbox for durable queue publish.
-- Writers insert domain rows + outbox in the same transaction; a relay
-- publishes via QueueAdapter and marks rows published (at-least-once).

CREATE TABLE IF NOT EXISTS transactional_outbox (
  id            UUID PRIMARY KEY,
  tenant_id     UUID NOT NULL,
  aggregate_type TEXT NOT NULL,
  aggregate_id  TEXT NOT NULL,
  event_type    TEXT NOT NULL,
  payload       JSONB NOT NULL,
  metadata      JSONB NOT NULL DEFAULT '{}'::jsonb,
  status        TEXT NOT NULL DEFAULT 'pending'
                CHECK (status IN ('pending', 'published', 'failed')),
  attempts      INT NOT NULL DEFAULT 0,
  last_error    TEXT,
  available_at  TIMESTAMPTZ NOT NULL DEFAULT now(),
  created_at    TIMESTAMPTZ NOT NULL DEFAULT now(),
  published_at  TIMESTAMPTZ
);

CREATE INDEX IF NOT EXISTS transactional_outbox_pending_idx
  ON transactional_outbox (available_at, created_at)
  WHERE status = 'pending';

CREATE INDEX IF NOT EXISTS transactional_outbox_tenant_idx
  ON transactional_outbox (tenant_id, created_at DESC);

ALTER TABLE transactional_outbox ENABLE ROW LEVEL SECURITY;
ALTER TABLE transactional_outbox FORCE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS tenant_isolation ON transactional_outbox;
CREATE POLICY tenant_isolation ON transactional_outbox
  FOR ALL
  USING (
    tenant_id::text = NULLIF(current_setting('app.tenant_id', true), '')
    OR NULLIF(current_setting('app.platform_admin', true), '') = '1'
  )
  WITH CHECK (
    tenant_id::text = NULLIF(current_setting('app.tenant_id', true), '')
    OR NULLIF(current_setting('app.platform_admin', true), '') = '1'
  );
