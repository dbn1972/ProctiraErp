-- Insights UI aggregates persistence (G-209).
-- Backs gateway insights-ui-plugin templates / runs / DW import jobs /
-- indicators / geo features so report writes survive restart when DATABASE_URL
-- is set. Real @proctira/backend-report / data-warehouse packages remain
-- separately mountable; this is the minimal UI-shape PG path.

CREATE TABLE IF NOT EXISTS insights_ui_templates (
  id TEXT PRIMARY KEY,
  name TEXT NOT NULL,
  description TEXT NOT NULL DEFAULT '',
  module TEXT NOT NULL,
  format JSONB NOT NULL DEFAULT '["PDF"]'::jsonb,
  filters JSONB NOT NULL DEFAULT '[]'::jsonb
);

CREATE TABLE IF NOT EXISTS insights_ui_runs (
  id UUID PRIMARY KEY,
  tenant_id TEXT NOT NULL,
  template_id TEXT NOT NULL,
  template_name TEXT NOT NULL,
  generated_at TIMESTAMPTZ NOT NULL,
  generated_by TEXT NOT NULL,
  format TEXT NOT NULL CHECK (format IN ('PDF', 'XLSX', 'CSV')),
  file_size_kb INT NOT NULL DEFAULT 0,
  status TEXT NOT NULL
    CHECK (status IN ('QUEUED', 'RUNNING', 'READY', 'FAILED')),
  download_url TEXT
);

CREATE INDEX IF NOT EXISTS idx_insights_ui_runs_tenant
  ON insights_ui_runs (tenant_id);

CREATE TABLE IF NOT EXISTS insights_ui_import_jobs (
  id UUID PRIMARY KEY,
  tenant_id TEXT NOT NULL,
  source TEXT NOT NULL CHECK (source IN ('EXCEL', 'CSV', 'DATABASE')),
  filename TEXT NOT NULL,
  submitted_at TIMESTAMPTZ NOT NULL,
  rows INT NOT NULL DEFAULT 0,
  status TEXT NOT NULL
    CHECK (status IN ('QUEUED', 'RUNNING', 'SUCCEEDED', 'FAILED')),
  error_message TEXT
);

CREATE INDEX IF NOT EXISTS idx_insights_ui_import_jobs_tenant
  ON insights_ui_import_jobs (tenant_id);

CREATE TABLE IF NOT EXISTS insights_ui_indicators (
  id TEXT PRIMARY KEY,
  code TEXT NOT NULL,
  name TEXT NOT NULL,
  category TEXT NOT NULL,
  unit TEXT NOT NULL,
  latest_value DOUBLE PRECISION,
  trend TEXT CHECK (trend IS NULL OR trend IN ('UP', 'DOWN', 'FLAT')),
  last_updated TIMESTAMPTZ
);

CREATE TABLE IF NOT EXISTS insights_ui_geo_features (
  institution_id TEXT PRIMARY KEY,
  name TEXT NOT NULL,
  latitude DOUBLE PRECISION NOT NULL,
  longitude DOUBLE PRECISION NOT NULL,
  type TEXT NOT NULL,
  enrolment INT NOT NULL DEFAULT 0
);

ALTER TABLE insights_ui_runs ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS tenant_isolation ON insights_ui_runs;
CREATE POLICY tenant_isolation ON insights_ui_runs
  FOR ALL
  USING (tenant_id::text = NULLIF(current_setting('app.tenant_id', true), ''))
  WITH CHECK (tenant_id::text = NULLIF(current_setting('app.tenant_id', true), ''));

ALTER TABLE insights_ui_import_jobs ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS tenant_isolation ON insights_ui_import_jobs;
CREATE POLICY tenant_isolation ON insights_ui_import_jobs
  FOR ALL
  USING (tenant_id::text = NULLIF(current_setting('app.tenant_id', true), ''))
  WITH CHECK (tenant_id::text = NULLIF(current_setting('app.tenant_id', true), ''));
