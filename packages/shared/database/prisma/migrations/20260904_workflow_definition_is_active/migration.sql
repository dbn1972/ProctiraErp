-- Pause / resume support for workflow definitions (is_active flag).

ALTER TABLE workflow.workflow_definitions
    ADD COLUMN IF NOT EXISTS "is_active" BOOLEAN NOT NULL DEFAULT TRUE;

CREATE INDEX IF NOT EXISTS "workflow_definitions_tenant_id_is_active_idx"
    ON workflow.workflow_definitions ("tenant_id", "is_active");
