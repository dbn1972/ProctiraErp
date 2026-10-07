-- PRC-H095: durable storage for student lifecycle certificates
-- (bonafide / transfer / character / leaving), W2-REC-01.
--
-- Previously issued certificates and their verification serials lived only in
-- process memory (InMemoryLifecycleCertificateRepository), so a restart or a
-- second gateway replica lost every issued certificate and reversed every
-- revocation. This table makes them durable and tenant-isolated.
--
-- Idempotent: safe to re-run (apply-sql.sh phase ledger records completion).
-- Rollback: forward-only; dropping the table makes verification fail again.

CREATE TABLE IF NOT EXISTS student_lifecycle_certificates (
  id            UUID PRIMARY KEY,
  tenant_id     UUID NOT NULL,
  student_id    TEXT NOT NULL,
  type          TEXT NOT NULL,
  serial_number TEXT NOT NULL,
  status        TEXT NOT NULL DEFAULT 'issued',
  issued_by     TEXT NOT NULL,
  issued_at     TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  revoked_at    TIMESTAMPTZ,
  revoke_reason TEXT,
  academic_year TEXT,
  remarks       TEXT,
  checksum      TEXT NOT NULL,
  created_at    TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at    TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  CONSTRAINT student_lifecycle_certificates_type_ck
    CHECK (type IN ('bonafide', 'transfer', 'character', 'leaving')),
  CONSTRAINT student_lifecycle_certificates_status_ck
    CHECK (status IN ('issued', 'revoked')),
  CONSTRAINT student_lifecycle_certificates_revoked_ck
    CHECK ((status = 'revoked') = (revoked_at IS NOT NULL))
);

-- Verification serials are tenant-scoped unique (public verify by serial).
CREATE UNIQUE INDEX IF NOT EXISTS student_lifecycle_certificates_serial_uidx
  ON student_lifecycle_certificates (tenant_id, serial_number);

-- Fast listByStudent, newest first.
CREATE INDEX IF NOT EXISTS student_lifecycle_certificates_student_idx
  ON student_lifecycle_certificates (tenant_id, student_id, issued_at DESC);

ALTER TABLE student_lifecycle_certificates ENABLE ROW LEVEL SECURITY;
ALTER TABLE student_lifecycle_certificates FORCE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS tenant_isolation ON student_lifecycle_certificates;
CREATE POLICY tenant_isolation ON student_lifecycle_certificates
  FOR ALL
  USING (tenant_id::text = NULLIF(current_setting('app.tenant_id', true), ''))
  WITH CHECK (tenant_id::text = NULLIF(current_setting('app.tenant_id', true), ''));

COMMENT ON TABLE student_lifecycle_certificates IS
  'PRC-H095 durable student lifecycle certificates (bonafide/transfer/character/leaving). Replaces the in-memory residual store.';

DO $h095_grant$
BEGIN
  IF EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'proctira_app') THEN
    GRANT SELECT, INSERT, UPDATE, DELETE
      ON TABLE student_lifecycle_certificates TO proctira_app;
  END IF;
END
$h095_grant$;
