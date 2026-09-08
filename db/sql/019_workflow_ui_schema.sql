-- Workflow UI aggregates persistence (G-208).
-- Backs gateway workflow-ui-plugin definitions / instances / approvals
-- so mutations survive process restart when DATABASE_URL is set.

CREATE TABLE IF NOT EXISTS workflow_ui_definitions (
  id UUID PRIMARY KEY,
  tenant_id TEXT NOT NULL,
  name TEXT NOT NULL,
  module TEXT NOT NULL,
  version INT NOT NULL DEFAULT 1,
  steps JSONB NOT NULL DEFAULT '[]'::jsonb,
  active BOOLEAN NOT NULL DEFAULT TRUE,
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_workflow_ui_definitions_tenant
  ON workflow_ui_definitions (tenant_id);

CREATE TABLE IF NOT EXISTS workflow_ui_instances (
  id UUID PRIMARY KEY,
  tenant_id TEXT NOT NULL,
  definition_id UUID NOT NULL,
  definition_name TEXT NOT NULL,
  subject_type TEXT NOT NULL,
  subject_id TEXT NOT NULL,
  initiated_by TEXT NOT NULL,
  initiated_at TIMESTAMPTZ NOT NULL,
  current_step TEXT NOT NULL,
  status TEXT NOT NULL
    CHECK (status IN ('PENDING', 'APPROVED', 'REJECTED', 'CANCELLED'))
);

CREATE INDEX IF NOT EXISTS idx_workflow_ui_instances_tenant
  ON workflow_ui_instances (tenant_id);

CREATE TABLE IF NOT EXISTS workflow_ui_approvals (
  id UUID PRIMARY KEY,
  tenant_id TEXT NOT NULL,
  instance_id UUID NOT NULL,
  definition_name TEXT NOT NULL,
  subject_type TEXT NOT NULL,
  subject_id TEXT NOT NULL,
  step_name TEXT NOT NULL,
  requested_at TIMESTAMPTZ NOT NULL,
  requested_by TEXT NOT NULL
);

CREATE INDEX IF NOT EXISTS idx_workflow_ui_approvals_tenant
  ON workflow_ui_approvals (tenant_id);

ALTER TABLE workflow_ui_definitions ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS tenant_isolation ON workflow_ui_definitions;
CREATE POLICY tenant_isolation ON workflow_ui_definitions
  FOR ALL
  USING (tenant_id::text = NULLIF(current_setting('app.tenant_id', true), ''))
  WITH CHECK (tenant_id::text = NULLIF(current_setting('app.tenant_id', true), ''));

ALTER TABLE workflow_ui_instances ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS tenant_isolation ON workflow_ui_instances;
CREATE POLICY tenant_isolation ON workflow_ui_instances
  FOR ALL
  USING (tenant_id::text = NULLIF(current_setting('app.tenant_id', true), ''))
  WITH CHECK (tenant_id::text = NULLIF(current_setting('app.tenant_id', true), ''));

ALTER TABLE workflow_ui_approvals ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS tenant_isolation ON workflow_ui_approvals;
CREATE POLICY tenant_isolation ON workflow_ui_approvals
  FOR ALL
  USING (tenant_id::text = NULLIF(current_setting('app.tenant_id', true), ''))
  WITH CHECK (tenant_id::text = NULLIF(current_setting('app.tenant_id', true), ''));
