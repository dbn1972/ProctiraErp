-- Wave 7 (G-715) — real workflow engine persistence for @proctira/backend-workflow.
--
-- The engine (definitions / instances / transition audit / cases) previously had
-- only an in-memory repository, which is why it was never mounted on the
-- gateway. These tables back PgWorkflowRepository + PgCaseRepository so the
-- engine can be composed under `/workflow-engine` with durable state.
--
-- Distinct from db/sql/019_workflow_ui_schema.sql (redesign UI aggregates).
-- Idempotent; RLS + FORCE + updated_at triggers like 024.

CREATE TABLE IF NOT EXISTS workflow_definitions (
  id               UUID PRIMARY KEY,
  tenant_id        UUID NOT NULL,
  name             TEXT NOT NULL,
  entity_type      TEXT NOT NULL,
  description      TEXT,
  states           JSONB NOT NULL DEFAULT '[]'::jsonb,
  transitions      JSONB NOT NULL DEFAULT '[]'::jsonb,
  escalation_rules JSONB,
  created_at       TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at       TIMESTAMPTZ NOT NULL DEFAULT NOW()
);
CREATE INDEX IF NOT EXISTS workflow_definitions_tenant_entity_idx
  ON workflow_definitions (tenant_id, entity_type, created_at DESC);

CREATE TABLE IF NOT EXISTS workflow_instances (
  id                     UUID PRIMARY KEY,
  tenant_id              UUID NOT NULL,
  workflow_definition_id UUID NOT NULL REFERENCES workflow_definitions(id) ON DELETE RESTRICT,
  entity_type            TEXT NOT NULL,
  entity_id              TEXT NOT NULL,
  current_state_id       TEXT NOT NULL,
  status                 TEXT NOT NULL DEFAULT 'ACTIVE'
                         CHECK (status IN ('ACTIVE','COMPLETED','CANCELLED')),
  metadata               JSONB,
  approvals              JSONB NOT NULL DEFAULT '[]'::jsonb,
  created_at             TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at             TIMESTAMPTZ NOT NULL DEFAULT NOW()
);
CREATE INDEX IF NOT EXISTS workflow_instances_tenant_entity_idx
  ON workflow_instances (tenant_id, entity_type, entity_id);
CREATE INDEX IF NOT EXISTS workflow_instances_tenant_status_idx
  ON workflow_instances (tenant_id, status, created_at DESC);
CREATE INDEX IF NOT EXISTS workflow_instances_definition_idx
  ON workflow_instances (tenant_id, workflow_definition_id);

CREATE TABLE IF NOT EXISTS workflow_transition_audit (
  id            UUID PRIMARY KEY,
  tenant_id     UUID NOT NULL,
  instance_id   UUID NOT NULL REFERENCES workflow_instances(id) ON DELETE CASCADE,
  from_state_id TEXT NOT NULL,
  to_state_id   TEXT NOT NULL,
  action        TEXT NOT NULL,
  actor_id      TEXT NOT NULL,
  comments      TEXT,
  occurred_at   TIMESTAMPTZ NOT NULL DEFAULT NOW()
);
CREATE INDEX IF NOT EXISTS workflow_transition_audit_instance_idx
  ON workflow_transition_audit (tenant_id, instance_id, occurred_at ASC);

CREATE TABLE IF NOT EXISTS workflow_cases (
  id                   UUID PRIMARY KEY,
  tenant_id            UUID NOT NULL,
  type                 TEXT NOT NULL,
  title                TEXT NOT NULL,
  description          TEXT NOT NULL,
  status               TEXT NOT NULL,
  entity_type          TEXT NOT NULL,
  entity_id            TEXT NOT NULL,
  institution_id       TEXT,
  area_id              TEXT,
  assigned_to          TEXT,
  priority             TEXT CHECK (priority IS NULL OR priority IN ('low','medium','high','critical')),
  workflow_instance_id UUID,
  attachments          JSONB NOT NULL DEFAULT '[]'::jsonb,
  resolution           JSONB,
  metadata             JSONB,
  created_at           TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at           TIMESTAMPTZ NOT NULL DEFAULT NOW()
);
CREATE INDEX IF NOT EXISTS workflow_cases_tenant_status_idx
  ON workflow_cases (tenant_id, status, created_at DESC);
CREATE INDEX IF NOT EXISTS workflow_cases_tenant_assignee_idx
  ON workflow_cases (tenant_id, assigned_to);
CREATE INDEX IF NOT EXISTS workflow_cases_tenant_entity_idx
  ON workflow_cases (tenant_id, entity_type, entity_id);

-- Append-only transition audit: rows may be inserted, never changed or removed.
CREATE OR REPLACE FUNCTION proctira_workflow_audit_immutable() RETURNS trigger AS $$
BEGIN
  RAISE EXCEPTION 'workflow_transition_audit is append-only (%)', TG_OP
    USING ERRCODE = 'integrity_constraint_violation';
END;
$$ LANGUAGE plpgsql;

DROP TRIGGER IF EXISTS trg_workflow_transition_audit_immutable ON workflow_transition_audit;
CREATE TRIGGER trg_workflow_transition_audit_immutable
  BEFORE UPDATE OR DELETE ON workflow_transition_audit
  FOR EACH ROW EXECUTE FUNCTION proctira_workflow_audit_immutable();

DO $$
DECLARE
  t TEXT;
BEGIN
  FOREACH t IN ARRAY ARRAY[
    'workflow_definitions', 'workflow_instances', 'workflow_transition_audit', 'workflow_cases'
  ]
  LOOP
    EXECUTE format('ALTER TABLE %I ENABLE ROW LEVEL SECURITY', t);
    EXECUTE format('ALTER TABLE %I FORCE ROW LEVEL SECURITY', t);
    EXECUTE format('DROP POLICY IF EXISTS tenant_isolation ON %I', t);
    EXECUTE format(
      'CREATE POLICY tenant_isolation ON %I FOR ALL
         USING (tenant_id::text = NULLIF(current_setting(''app.tenant_id'', true), '''')
                OR current_setting(''app.platform_admin'', true) = ''1'')
         WITH CHECK (tenant_id::text = NULLIF(current_setting(''app.tenant_id'', true), '''')
                OR current_setting(''app.platform_admin'', true) = ''1'')',
      t
    );
  END LOOP;

  IF to_regprocedure('proctira_set_updated_at()') IS NOT NULL THEN
    FOREACH t IN ARRAY ARRAY['workflow_definitions', 'workflow_instances', 'workflow_cases']
    LOOP
      EXECUTE format('DROP TRIGGER IF EXISTS trg_%s_updated_at ON %I', t, t);
      EXECUTE format(
        'CREATE TRIGGER trg_%s_updated_at BEFORE UPDATE ON %I
           FOR EACH ROW EXECUTE FUNCTION proctira_set_updated_at()',
        t, t
      );
    END LOOP;
  END IF;
END $$;
