-- W1-SEC-06 (slice): privacy legal hold + erasure/anonymization request foundation.
-- Additive only. Does not implement correction workflow or full tenant offboarding.

ALTER TABLE tenants
  ADD COLUMN IF NOT EXISTS legal_hold BOOLEAN NOT NULL DEFAULT false;

COMMENT ON COLUMN tenants.legal_hold IS
  'When true, destructive deletes / erasure against this tenant MUST fail closed (W1-SEC-06).';

CREATE INDEX IF NOT EXISTS idx_tenants_legal_hold
  ON tenants (legal_hold)
  WHERE legal_hold = true;

CREATE TABLE IF NOT EXISTS privacy_legal_holds (
  id              UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  tenant_id       UUID NOT NULL REFERENCES tenants(id),
  scope           TEXT NOT NULL,
  subject_type    TEXT,
  subject_id      TEXT,
  reason          TEXT NOT NULL,
  placed_by       TEXT NOT NULL,
  placed_at       TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  released_by     TEXT,
  released_at     TIMESTAMPTZ,
  active          BOOLEAN NOT NULL DEFAULT true,
  created_at      TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at      TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  CONSTRAINT privacy_legal_holds_scope_check
    CHECK (scope IN ('tenant', 'subject')),
  CONSTRAINT privacy_legal_holds_subject_check
    CHECK (
      (scope = 'tenant' AND subject_type IS NULL AND subject_id IS NULL)
      OR (scope = 'subject' AND subject_type IS NOT NULL AND subject_id IS NOT NULL)
    ),
  CONSTRAINT privacy_legal_holds_release_check
    CHECK (
      (active = true AND released_at IS NULL AND released_by IS NULL)
      OR (active = false AND released_at IS NOT NULL AND released_by IS NOT NULL)
    )
);

CREATE INDEX IF NOT EXISTS idx_privacy_legal_holds_tenant_active
  ON privacy_legal_holds (tenant_id, active)
  WHERE active = true;

CREATE INDEX IF NOT EXISTS idx_privacy_legal_holds_subject_active
  ON privacy_legal_holds (tenant_id, subject_type, subject_id, active)
  WHERE active = true AND scope = 'subject';

COMMENT ON TABLE privacy_legal_holds IS
  'W1-SEC-06 legal holds. Active rows block erasure and destructive deletes (fail-closed).';

CREATE TABLE IF NOT EXISTS privacy_erasure_requests (
  id              UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  tenant_id       UUID NOT NULL REFERENCES tenants(id),
  subject_type    TEXT NOT NULL,
  subject_id      TEXT NOT NULL,
  status          TEXT NOT NULL DEFAULT 'requested',
  request_type    TEXT NOT NULL DEFAULT 'erasure',
  reason          TEXT,
  requested_by    TEXT NOT NULL,
  reviewed_by     TEXT,
  status_reason   TEXT,
  completed_at    TIMESTAMPTZ,
  created_at      TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at      TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  CONSTRAINT privacy_erasure_status_check
    CHECK (status IN (
      'requested','under_review','approved','in_progress','completed','rejected','cancelled','blocked_legal_hold'
    )),
  CONSTRAINT privacy_erasure_type_check
    CHECK (request_type IN ('erasure', 'anonymization'))
);

CREATE INDEX IF NOT EXISTS idx_privacy_erasure_tenant_status
  ON privacy_erasure_requests (tenant_id, status, created_at DESC);

CREATE INDEX IF NOT EXISTS idx_privacy_erasure_subject
  ON privacy_erasure_requests (tenant_id, subject_type, subject_id, created_at DESC);

COMMENT ON TABLE privacy_erasure_requests IS
  'W1-SEC-06 erasure/anonymization requests with status machine. Execution blocked under legal hold.';

ALTER TABLE privacy_legal_holds ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS tenant_isolation ON privacy_legal_holds;
CREATE POLICY tenant_isolation ON privacy_legal_holds
  FOR ALL
  USING (tenant_id::text = NULLIF(current_setting('app.tenant_id', true), ''))
  WITH CHECK (tenant_id::text = NULLIF(current_setting('app.tenant_id', true), ''));

ALTER TABLE privacy_erasure_requests ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS tenant_isolation ON privacy_erasure_requests;
CREATE POLICY tenant_isolation ON privacy_erasure_requests
  FOR ALL
  USING (tenant_id::text = NULLIF(current_setting('app.tenant_id', true), ''))
  WITH CHECK (tenant_id::text = NULLIF(current_setting('app.tenant_id', true), ''));
