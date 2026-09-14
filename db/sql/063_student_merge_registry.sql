-- W2-SIS-02: durable student duplicate-merge audit registry.

CREATE TABLE IF NOT EXISTS student_merges (
  id UUID PRIMARY KEY,
  tenant_id UUID NOT NULL,
  survivor_student_id UUID NOT NULL REFERENCES students(id),
  duplicate_student_id UUID NOT NULL REFERENCES students(id),
  reason TEXT NOT NULL,
  merged_by TEXT,
  enrollments_reassigned INTEGER NOT NULL DEFAULT 0 CHECK (enrollments_reassigned >= 0),
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  UNIQUE (tenant_id, duplicate_student_id)
);
CREATE INDEX IF NOT EXISTS student_merges_tenant_survivor_idx
  ON student_merges (tenant_id, survivor_student_id);

ALTER TABLE student_merges ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS tenant_isolation ON student_merges;
CREATE POLICY tenant_isolation ON student_merges
  USING (tenant_id = NULLIF(current_setting('app.tenant_id', true), '')::uuid)
  WITH CHECK (tenant_id = NULLIF(current_setting('app.tenant_id', true), '')::uuid);
ALTER TABLE student_merges FORCE ROW LEVEL SECURITY;
