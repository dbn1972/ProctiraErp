-- W1-SEC-06 complete slice: correction requests, durable anonymization job
-- tracking, and tenant offboard wipe jobs with legal-hold fail-closed notes.
-- Additive only. Does not claim full cross-domain PII cascade wipe.

CREATE TABLE IF NOT EXISTS privacy_correction_requests (
  id                UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  tenant_id         UUID NOT NULL REFERENCES tenants(id),
  subject_type      TEXT NOT NULL,
  subject_id        TEXT NOT NULL,
  field_path        TEXT NOT NULL,
  current_value     TEXT,
  requested_value   TEXT NOT NULL,
  reason            TEXT,
  status            TEXT NOT NULL DEFAULT 'requested',
  requested_by      TEXT NOT NULL,
  reviewed_by       TEXT,
  status_reason     TEXT,
  applied_at        TIMESTAMPTZ,
  created_at        TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at        TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  CONSTRAINT privacy_correction_status_check
    CHECK (status IN (
      'requested','under_review','approved','applied','rejected','cancelled'
    ))
);

CREATE INDEX IF NOT EXISTS idx_privacy_correction_tenant_status
  ON privacy_correction_requests (tenant_id, status, created_at DESC);

CREATE INDEX IF NOT EXISTS idx_privacy_correction_subject
  ON privacy_correction_requests (tenant_id, subject_type, subject_id, created_at DESC);

COMMENT ON TABLE privacy_correction_requests IS
  'W1-SEC-06 rectification/correction requests. Apply path must emit audit.';

CREATE TABLE IF NOT EXISTS privacy_anonymization_jobs (
  id                UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  tenant_id         UUID NOT NULL REFERENCES tenants(id),
  erasure_request_id UUID NOT NULL REFERENCES privacy_erasure_requests(id),
  subject_type      TEXT NOT NULL,
  subject_id        TEXT NOT NULL,
  request_type      TEXT NOT NULL,
  status            TEXT NOT NULL DEFAULT 'queued',
  actor_id          TEXT NOT NULL,
  status_reason     TEXT,
  fields_touched    JSONB NOT NULL DEFAULT '[]'::jsonb,
  residual_note     TEXT,
  started_at        TIMESTAMPTZ,
  completed_at      TIMESTAMPTZ,
  created_at        TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at        TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  CONSTRAINT privacy_anonymization_status_check
    CHECK (status IN (
      'queued','in_progress','completed','failed','blocked_legal_hold'
    )),
  CONSTRAINT privacy_anonymization_type_check
    CHECK (request_type IN ('erasure', 'anonymization'))
);

CREATE INDEX IF NOT EXISTS idx_privacy_anonymization_tenant_status
  ON privacy_anonymization_jobs (tenant_id, status, created_at DESC);

CREATE INDEX IF NOT EXISTS idx_privacy_anonymization_erasure
  ON privacy_anonymization_jobs (erasure_request_id);

COMMENT ON TABLE privacy_anonymization_jobs IS
  'W1-SEC-06 durable anonymization/erasure execution jobs (queue-backed).';

CREATE TABLE IF NOT EXISTS privacy_tenant_offboard_jobs (
  id                UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  tenant_id         UUID NOT NULL REFERENCES tenants(id),
  status            TEXT NOT NULL DEFAULT 'requested',
  reason            TEXT NOT NULL,
  requested_by      TEXT NOT NULL,
  status_reason     TEXT,
  checklist         JSONB NOT NULL DEFAULT '[]'::jsonb,
  residual_note     TEXT,
  started_at        TIMESTAMPTZ,
  completed_at      TIMESTAMPTZ,
  created_at        TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at        TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  CONSTRAINT privacy_offboard_status_check
    CHECK (status IN (
      'requested','queued','in_progress','completed','failed','blocked_legal_hold','cancelled'
    ))
);

CREATE INDEX IF NOT EXISTS idx_privacy_offboard_tenant_status
  ON privacy_tenant_offboard_jobs (tenant_id, status, created_at DESC);

COMMENT ON TABLE privacy_tenant_offboard_jobs IS
  'W1-SEC-06 tenant offboard wipe orchestration. Active legal hold fails closed.';

ALTER TABLE privacy_correction_requests ENABLE ROW LEVEL SECURITY;
ALTER TABLE privacy_correction_requests FORCE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS tenant_isolation ON privacy_correction_requests;
CREATE POLICY tenant_isolation ON privacy_correction_requests
  FOR ALL
  USING (tenant_id::text = NULLIF(current_setting('app.tenant_id', true), ''))
  WITH CHECK (tenant_id::text = NULLIF(current_setting('app.tenant_id', true), ''));

ALTER TABLE privacy_anonymization_jobs ENABLE ROW LEVEL SECURITY;
ALTER TABLE privacy_anonymization_jobs FORCE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS tenant_isolation ON privacy_anonymization_jobs;
CREATE POLICY tenant_isolation ON privacy_anonymization_jobs
  FOR ALL
  USING (tenant_id::text = NULLIF(current_setting('app.tenant_id', true), ''))
  WITH CHECK (tenant_id::text = NULLIF(current_setting('app.tenant_id', true), ''));

ALTER TABLE privacy_tenant_offboard_jobs ENABLE ROW LEVEL SECURITY;
ALTER TABLE privacy_tenant_offboard_jobs FORCE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS tenant_isolation ON privacy_tenant_offboard_jobs;
CREATE POLICY tenant_isolation ON privacy_tenant_offboard_jobs
  FOR ALL
  USING (tenant_id::text = NULLIF(current_setting('app.tenant_id', true), ''))
  WITH CHECK (tenant_id::text = NULLIF(current_setting('app.tenant_id', true), ''));
