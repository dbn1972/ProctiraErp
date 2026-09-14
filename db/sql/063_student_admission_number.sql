-- W2-SIS-01: durable per-tenant admission number issuance.
-- UI already displays customData.admissionNo / admissionNumber; the service
-- must allocate a unique number on create (not leave the field empty).

ALTER TABLE students
  ADD COLUMN IF NOT EXISTS admission_number VARCHAR(50);

CREATE UNIQUE INDEX IF NOT EXISTS students_tenant_admission_number_uidx
  ON students (tenant_id, admission_number)
  WHERE admission_number IS NOT NULL AND deleted_at IS NULL;

CREATE TABLE IF NOT EXISTS student_admission_counters (
  tenant_id UUID PRIMARY KEY,
  last_value BIGINT NOT NULL DEFAULT 0 CHECK (last_value >= 0),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

ALTER TABLE student_admission_counters ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS tenant_isolation ON student_admission_counters;
CREATE POLICY tenant_isolation ON student_admission_counters
  USING (tenant_id = NULLIF(current_setting('app.tenant_id', true), '')::uuid)
  WITH CHECK (tenant_id = NULLIF(current_setting('app.tenant_id', true), '')::uuid);
ALTER TABLE student_admission_counters FORCE ROW LEVEL SECURITY;
