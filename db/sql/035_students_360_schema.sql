-- Students 360 (Wave 9 / G-914): photo metadata, sibling links, consent
-- flags, and discipline / behaviour incidents. Raw SQL — applied after 030
-- via tools/scripts/apply-sql.sh.
--
-- Photo bytes live in object storage (S3/MinIO) or a local-disk fallback;
-- this table stores the object key + mime/size/actor only.

CREATE TABLE IF NOT EXISTS student_photos (
  id UUID PRIMARY KEY,
  tenant_id UUID NOT NULL,
  student_id UUID NOT NULL REFERENCES students(id) ON DELETE CASCADE,
  object_key TEXT NOT NULL,
  mime_type TEXT NOT NULL,
  size_bytes INTEGER NOT NULL CHECK (size_bytes > 0 AND size_bytes <= 2097152),
  uploaded_by TEXT NOT NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  UNIQUE (tenant_id, student_id)
);
CREATE INDEX IF NOT EXISTS student_photos_tenant_student_idx
  ON student_photos (tenant_id, student_id);

CREATE TABLE IF NOT EXISTS student_siblings (
  id UUID PRIMARY KEY,
  tenant_id UUID NOT NULL,
  student_id UUID NOT NULL REFERENCES students(id) ON DELETE CASCADE,
  sibling_id UUID NOT NULL REFERENCES students(id) ON DELETE CASCADE,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  CHECK (student_id <> sibling_id),
  UNIQUE (tenant_id, student_id, sibling_id)
);
CREATE INDEX IF NOT EXISTS student_siblings_tenant_sibling_idx
  ON student_siblings (tenant_id, sibling_id);

CREATE TABLE IF NOT EXISTS student_consents (
  id UUID PRIMARY KEY,
  tenant_id UUID NOT NULL,
  student_id UUID NOT NULL REFERENCES students(id) ON DELETE CASCADE,
  kind TEXT NOT NULL
    CHECK (kind IN ('photo', 'medical', 'trips', 'data_sharing')),
  granted BOOLEAN NOT NULL,
  actor_id TEXT NOT NULL,
  recorded_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  UNIQUE (tenant_id, student_id, kind)
);
CREATE INDEX IF NOT EXISTS student_consents_tenant_student_idx
  ON student_consents (tenant_id, student_id);

CREATE TABLE IF NOT EXISTS student_discipline_incidents (
  id UUID PRIMARY KEY,
  tenant_id UUID NOT NULL,
  student_id UUID NOT NULL REFERENCES students(id) ON DELETE CASCADE,
  incident_type TEXT NOT NULL,
  severity TEXT NOT NULL
    CHECK (severity IN ('low', 'medium', 'high', 'critical')),
  description TEXT NOT NULL,
  action_taken TEXT,
  reporter_id TEXT NOT NULL,
  incident_date DATE NOT NULL,
  visible_to_parent BOOLEAN NOT NULL DEFAULT false,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS student_discipline_tenant_student_idx
  ON student_discipline_incidents (tenant_id, student_id, incident_date DESC);

-- ---------------------------------------------------------------------------
-- RLS (same policy shape as 030; tenant bound via withPgTenant / app.tenant_id)
-- ---------------------------------------------------------------------------
ALTER TABLE student_photos ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS tenant_isolation ON student_photos;
CREATE POLICY tenant_isolation ON student_photos
  FOR ALL
  USING (tenant_id::text = NULLIF(current_setting('app.tenant_id', true), ''))
  WITH CHECK (tenant_id::text = NULLIF(current_setting('app.tenant_id', true), ''));
ALTER TABLE student_photos FORCE ROW LEVEL SECURITY;

ALTER TABLE student_siblings ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS tenant_isolation ON student_siblings;
CREATE POLICY tenant_isolation ON student_siblings
  FOR ALL
  USING (tenant_id::text = NULLIF(current_setting('app.tenant_id', true), ''))
  WITH CHECK (tenant_id::text = NULLIF(current_setting('app.tenant_id', true), ''));
ALTER TABLE student_siblings FORCE ROW LEVEL SECURITY;

ALTER TABLE student_consents ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS tenant_isolation ON student_consents;
CREATE POLICY tenant_isolation ON student_consents
  FOR ALL
  USING (tenant_id::text = NULLIF(current_setting('app.tenant_id', true), ''))
  WITH CHECK (tenant_id::text = NULLIF(current_setting('app.tenant_id', true), ''));
ALTER TABLE student_consents FORCE ROW LEVEL SECURITY;

ALTER TABLE student_discipline_incidents ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS tenant_isolation ON student_discipline_incidents;
CREATE POLICY tenant_isolation ON student_discipline_incidents
  FOR ALL
  USING (tenant_id::text = NULLIF(current_setting('app.tenant_id', true), ''))
  WITH CHECK (tenant_id::text = NULLIF(current_setting('app.tenant_id', true), ''));
ALTER TABLE student_discipline_incidents FORCE ROW LEVEL SECURITY;
