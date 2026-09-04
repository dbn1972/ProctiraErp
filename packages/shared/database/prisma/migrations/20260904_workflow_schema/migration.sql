-- Phase schema ownership: workflow (charter §19)
-- CREATE SCHEMA + tables; bare UUID tenant/cross-domain ids (no cross-schema FKs).

CREATE SCHEMA IF NOT EXISTS workflow;
CREATE EXTENSION IF NOT EXISTS "uuid-ossp";

CREATE TABLE IF NOT EXISTS workflow.workflow_definitions (
  id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  tenant_id UUID NOT NULL,
  name VARCHAR(255) NOT NULL,
  entity_type VARCHAR(100) NOT NULL,
  description TEXT,
  states JSONB NOT NULL DEFAULT '[]'::jsonb,
  transitions JSONB NOT NULL DEFAULT '[]'::jsonb,
  escalation_rules JSONB,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);
CREATE INDEX IF NOT EXISTS workflow_definitions_tenant_id_entity_type_idx ON workflow.workflow_definitions (tenant_id, entity_type);

CREATE TABLE IF NOT EXISTS workflow.workflow_instances (
  id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  tenant_id UUID NOT NULL,
  workflow_definition_id UUID NOT NULL,
  entity_type VARCHAR(100) NOT NULL,
  entity_id UUID NOT NULL,
  current_state_id VARCHAR(100) NOT NULL,
  status VARCHAR(30) NOT NULL,
  metadata JSONB,
  approvals JSONB NOT NULL DEFAULT '[]'::jsonb,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);
CREATE INDEX IF NOT EXISTS workflow_instances_tenant_id_workflow_definition_id_idx ON workflow.workflow_instances (tenant_id, workflow_definition_id);
CREATE INDEX IF NOT EXISTS workflow_instances_tenant_id_entity_type_entity_id_idx ON workflow.workflow_instances (tenant_id, entity_type, entity_id);

CREATE TABLE IF NOT EXISTS workflow.transition_audits (
  id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  tenant_id UUID NOT NULL,
  instance_id UUID NOT NULL,
  from_state_id VARCHAR(100) NOT NULL,
  to_state_id VARCHAR(100) NOT NULL,
  action VARCHAR(100) NOT NULL,
  actor_id UUID NOT NULL,
  comments TEXT,
  timestamp TIMESTAMPTZ NOT NULL
);
CREATE INDEX IF NOT EXISTS transition_audits_tenant_id_instance_id_idx ON workflow.transition_audits (tenant_id, instance_id);

CREATE TABLE IF NOT EXISTS workflow.cases (
  id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  tenant_id UUID NOT NULL,
  type VARCHAR(50) NOT NULL,
  title VARCHAR(255) NOT NULL,
  description TEXT NOT NULL,
  status VARCHAR(30) NOT NULL,
  entity_type VARCHAR(100) NOT NULL,
  entity_id UUID NOT NULL,
  institution_id UUID,
  area_id UUID,
  assigned_to UUID,
  priority VARCHAR(20),
  workflow_instance_id UUID,
  attachments JSONB NOT NULL DEFAULT '[]'::jsonb,
  resolution JSONB,
  metadata JSONB,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);
CREATE INDEX IF NOT EXISTS cases_tenant_id_status_idx ON workflow.cases (tenant_id, status);
CREATE INDEX IF NOT EXISTS cases_tenant_id_entity_type_entity_id_idx ON workflow.cases (tenant_id, entity_type, entity_id);

