-- W2-SIS-03: general student document / blob registry (beyond profile photos).
-- Bytes live in object storage (S3/MinIO) or the local-disk StudentBlobStore;
-- this table stores metadata + object key only.

CREATE TABLE IF NOT EXISTS student_documents (
  id UUID PRIMARY KEY,
  tenant_id UUID NOT NULL,
  student_id UUID NOT NULL REFERENCES students(id) ON DELETE CASCADE,
  category TEXT NOT NULL
    CHECK (category IN (
      'birth_certificate',
      'transfer_certificate',
      'passport',
      'national_id',
      'medical',
      'address_proof',
      'previous_marksheet',
      'other'
    )),
  file_name TEXT NOT NULL,
  object_key TEXT NOT NULL,
  mime_type TEXT NOT NULL,
  size_bytes INTEGER NOT NULL CHECK (size_bytes > 0 AND size_bytes <= 10485760),
  uploaded_by TEXT NOT NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS student_documents_tenant_student_idx
  ON student_documents (tenant_id, student_id, created_at DESC);
CREATE INDEX IF NOT EXISTS student_documents_tenant_category_idx
  ON student_documents (tenant_id, student_id, category);

ALTER TABLE student_documents ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS tenant_isolation ON student_documents;
CREATE POLICY tenant_isolation ON student_documents
  FOR ALL
  USING (tenant_id::text = NULLIF(current_setting('app.tenant_id', true), ''))
  WITH CHECK (tenant_id::text = NULLIF(current_setting('app.tenant_id', true), ''));
ALTER TABLE student_documents FORCE ROW LEVEL SECURITY;
