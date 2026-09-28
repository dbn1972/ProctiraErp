-- Scholarship application supporting documents (income certificate, marksheet,
-- caste/category certificate, ID proof, and other scheme-required files).
--
-- Bytes live in object storage (S3/MinIO via @proctira/storage) or the local-disk
-- scholarship blob store. This table stores metadata, the object key, and
-- reviewer verification. Idempotent: safe to re-apply.
--
-- Rollback: forward-fix only. Dropping the table would orphan object keys;
-- a corrective migration should soft-delete rows (deleted_at) instead.

CREATE UNIQUE INDEX IF NOT EXISTS scholarship_applications_tenant_id_uidx
  ON scholarship_applications (tenant_id, id);

CREATE TABLE IF NOT EXISTS scholarship_application_documents (
  id UUID PRIMARY KEY,
  tenant_id UUID NOT NULL REFERENCES tenants(id),
  application_id UUID NOT NULL,
  document_type TEXT NOT NULL CHECK (document_type ~ '^[a-z][a-z0-9_]{0,63}$'),
  object_key TEXT NOT NULL CHECK (length(object_key) BETWEEN 1 AND 1024),
  original_filename TEXT NOT NULL CHECK (length(original_filename) BETWEEN 1 AND 180),
  mime_type TEXT NOT NULL CHECK (mime_type IN ('application/pdf', 'image/jpeg', 'image/png')),
  size_bytes INTEGER NOT NULL CHECK (size_bytes > 0 AND size_bytes <= 10485760),
  sha256 TEXT NOT NULL CHECK (sha256 ~ '^[0-9a-f]{64}$'),
  uploaded_by TEXT NOT NULL,
  uploaded_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  verification_status TEXT NOT NULL DEFAULT 'PENDING'
    CHECK (verification_status IN ('PENDING', 'VERIFIED', 'REJECTED')),
  reviewer_id TEXT,
  rejection_reason TEXT,
  reviewed_at TIMESTAMPTZ,
  deleted_at TIMESTAMPTZ,
  CONSTRAINT scholarship_application_documents_tenant_app_fk
    FOREIGN KEY (tenant_id, application_id)
    REFERENCES scholarship_applications (tenant_id, id)
    ON DELETE CASCADE,
  CONSTRAINT scholarship_application_documents_rejection_ck
    CHECK (
      (verification_status <> 'REJECTED')
      OR (rejection_reason IS NOT NULL AND length(btrim(rejection_reason)) > 0)
    )
);

CREATE INDEX IF NOT EXISTS scholarship_application_documents_tenant_app_idx
  ON scholarship_application_documents (tenant_id, application_id, uploaded_at)
  WHERE deleted_at IS NULL;

CREATE INDEX IF NOT EXISTS scholarship_application_documents_tenant_status_idx
  ON scholarship_application_documents (tenant_id, verification_status)
  WHERE deleted_at IS NULL;

ALTER TABLE scholarship_application_documents ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS tenant_isolation ON scholarship_application_documents;
CREATE POLICY tenant_isolation ON scholarship_application_documents
  FOR ALL
  USING (tenant_id::text = NULLIF(current_setting('app.tenant_id', true), ''))
  WITH CHECK (tenant_id::text = NULLIF(current_setting('app.tenant_id', true), ''));
ALTER TABLE scholarship_application_documents FORCE ROW LEVEL SECURITY;

DO $$
BEGIN
  IF EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'proctira_app') THEN
    GRANT SELECT, INSERT, UPDATE, DELETE
      ON TABLE scholarship_application_documents TO proctira_app;
  END IF;
END $$;
