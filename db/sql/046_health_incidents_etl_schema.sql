-- Wave 10 Option B/C — nurse incidents + ETL pipeline durable store.
-- Applied via tools/scripts/apply-sql.sh (numeric order after 045).

-- ---------------------------------------------------------------------------
-- Nurse / clinic visit incidents (health)
-- ---------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS health_nurse_incidents (
  id UUID PRIMARY KEY,
  tenant_id UUID NOT NULL,
  student_id UUID NOT NULL,
  institution_id UUID,
  incident_at TIMESTAMPTZ NOT NULL,
  category TEXT NOT NULL,
  severity TEXT NOT NULL CHECK (severity IN ('low', 'medium', 'high', 'critical')),
  notes TEXT NOT NULL DEFAULT '',
  reported_by TEXT NOT NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS health_nurse_incidents_student_idx
  ON health_nurse_incidents (tenant_id, student_id, incident_at DESC);

ALTER TABLE health_nurse_incidents ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS tenant_isolation ON health_nurse_incidents;
CREATE POLICY tenant_isolation ON health_nurse_incidents
  FOR ALL
  USING (tenant_id::text = NULLIF(current_setting('app.tenant_id', true), ''))
  WITH CHECK (tenant_id::text = NULLIF(current_setting('app.tenant_id', true), ''));
ALTER TABLE health_nurse_incidents FORCE ROW LEVEL SECURITY;

-- ---------------------------------------------------------------------------
-- ETL pipelines (Option C thin un-park) — JSON document store for Pipeline entity
-- ---------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS etl_pipelines (
  id UUID PRIMARY KEY,
  tenant_id UUID NOT NULL,
  name TEXT NOT NULL,
  enabled BOOLEAN NOT NULL DEFAULT true,
  document JSONB NOT NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS etl_pipelines_tenant_name_idx
  ON etl_pipelines (tenant_id, name);

CREATE TABLE IF NOT EXISTS etl_pipeline_runs (
  id UUID PRIMARY KEY,
  tenant_id UUID NOT NULL,
  pipeline_id UUID NOT NULL REFERENCES etl_pipelines(id) ON DELETE CASCADE,
  status TEXT NOT NULL,
  document JSONB NOT NULL,
  started_at TIMESTAMPTZ NOT NULL,
  completed_at TIMESTAMPTZ,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS etl_pipeline_runs_pipeline_idx
  ON etl_pipeline_runs (tenant_id, pipeline_id, started_at DESC);

ALTER TABLE etl_pipelines ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS tenant_isolation ON etl_pipelines;
CREATE POLICY tenant_isolation ON etl_pipelines
  FOR ALL
  USING (tenant_id::text = NULLIF(current_setting('app.tenant_id', true), ''))
  WITH CHECK (tenant_id::text = NULLIF(current_setting('app.tenant_id', true), ''));
ALTER TABLE etl_pipelines FORCE ROW LEVEL SECURITY;

ALTER TABLE etl_pipeline_runs ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS tenant_isolation ON etl_pipeline_runs;
CREATE POLICY tenant_isolation ON etl_pipeline_runs
  FOR ALL
  USING (tenant_id::text = NULLIF(current_setting('app.tenant_id', true), ''))
  WITH CHECK (tenant_id::text = NULLIF(current_setting('app.tenant_id', true), ''));
ALTER TABLE etl_pipeline_runs FORCE ROW LEVEL SECURITY;
