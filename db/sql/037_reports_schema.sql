-- Reports catalogue persistence (Wave 9 / G-909).
-- Artifacts, cadence schedules, and run history for real CSV / XLSX / PDF
-- exports. Applied after 034 via tools/scripts/apply-sql.sh.
-- RLS: tenant_isolation on app.tenant_id, FORCE ROW LEVEL SECURITY (030 pattern).
-- platform_admin SELECT lets the in-process scheduler list due rows across tenants
-- then each run executes inside withPgTenant.

CREATE TABLE IF NOT EXISTS report_artifacts (
  id UUID PRIMARY KEY,
  tenant_id UUID NOT NULL,
  report_key TEXT NOT NULL,
  format TEXT NOT NULL CHECK (format IN ('csv', 'xlsx', 'pdf')),
  object_key TEXT NOT NULL,
  sha256 TEXT NOT NULL CHECK (sha256 ~ '^[0-9a-f]{64}$'),
  size_bytes BIGINT NOT NULL CHECK (size_bytes >= 0),
  requested_by TEXT NOT NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS report_artifacts_tenant_created_idx
  ON report_artifacts (tenant_id, created_at DESC);
CREATE INDEX IF NOT EXISTS report_artifacts_tenant_key_idx
  ON report_artifacts (tenant_id, report_key);

CREATE TABLE IF NOT EXISTS report_schedules (
  id UUID PRIMARY KEY,
  tenant_id UUID NOT NULL,
  report_key TEXT NOT NULL,
  format TEXT NOT NULL CHECK (format IN ('csv', 'xlsx', 'pdf')),
  cadence TEXT NOT NULL CHECK (cadence IN ('daily', 'weekly', 'monthly')),
  next_run_at TIMESTAMPTZ NOT NULL,
  recipients JSONB NOT NULL DEFAULT '[]'::jsonb,
  enabled BOOLEAN NOT NULL DEFAULT true,
  created_by TEXT NOT NULL DEFAULT 'system',
  last_run_at TIMESTAMPTZ,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS report_schedules_due_idx
  ON report_schedules (enabled, next_run_at)
  WHERE enabled;

CREATE TABLE IF NOT EXISTS report_runs (
  id UUID PRIMARY KEY,
  tenant_id UUID NOT NULL,
  schedule_id UUID REFERENCES report_schedules(id) ON DELETE SET NULL,
  artifact_id UUID REFERENCES report_artifacts(id) ON DELETE SET NULL,
  report_key TEXT NOT NULL,
  format TEXT NOT NULL CHECK (format IN ('csv', 'xlsx', 'pdf')),
  source TEXT NOT NULL CHECK (source IN ('manual', 'schedule')),
  status TEXT NOT NULL CHECK (status IN ('queued', 'running', 'completed', 'failed')),
  error TEXT,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  completed_at TIMESTAMPTZ
);
CREATE INDEX IF NOT EXISTS report_runs_tenant_created_idx
  ON report_runs (tenant_id, created_at DESC);
CREATE INDEX IF NOT EXISTS report_runs_schedule_idx
  ON report_runs (tenant_id, schedule_id);

-- ---------------------------------------------------------------------------
-- RLS (030 academic-calendar pattern)
-- ---------------------------------------------------------------------------
ALTER TABLE report_artifacts ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS tenant_isolation ON report_artifacts;
CREATE POLICY tenant_isolation ON report_artifacts
  FOR ALL
  USING (tenant_id::text = NULLIF(current_setting('app.tenant_id', true), ''))
  WITH CHECK (tenant_id::text = NULLIF(current_setting('app.tenant_id', true), ''));
DROP POLICY IF EXISTS platform_admin_read ON report_artifacts;
CREATE POLICY platform_admin_read ON report_artifacts
  FOR SELECT
  USING (NULLIF(current_setting('app.platform_admin', true), '') = '1');
ALTER TABLE report_artifacts FORCE ROW LEVEL SECURITY;

ALTER TABLE report_schedules ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS tenant_isolation ON report_schedules;
CREATE POLICY tenant_isolation ON report_schedules
  FOR ALL
  USING (tenant_id::text = NULLIF(current_setting('app.tenant_id', true), ''))
  WITH CHECK (tenant_id::text = NULLIF(current_setting('app.tenant_id', true), ''));
DROP POLICY IF EXISTS platform_admin_read ON report_schedules;
CREATE POLICY platform_admin_read ON report_schedules
  FOR SELECT
  USING (NULLIF(current_setting('app.platform_admin', true), '') = '1');
ALTER TABLE report_schedules FORCE ROW LEVEL SECURITY;

ALTER TABLE report_runs ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS tenant_isolation ON report_runs;
CREATE POLICY tenant_isolation ON report_runs
  FOR ALL
  USING (tenant_id::text = NULLIF(current_setting('app.tenant_id', true), ''))
  WITH CHECK (tenant_id::text = NULLIF(current_setting('app.tenant_id', true), ''));
DROP POLICY IF EXISTS platform_admin_read ON report_runs;
CREATE POLICY platform_admin_read ON report_runs
  FOR SELECT
  USING (NULLIF(current_setting('app.platform_admin', true), '') = '1');
ALTER TABLE report_runs FORCE ROW LEVEL SECURITY;
