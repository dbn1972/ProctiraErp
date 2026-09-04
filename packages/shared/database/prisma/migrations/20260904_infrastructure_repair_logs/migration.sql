-- Infrastructure repair / maintenance logs (institution schema).
-- Bare UUID refs for tenant / institution / item (charter §19 — no cross-schema FKs).

CREATE EXTENSION IF NOT EXISTS "uuid-ossp";

CREATE TABLE IF NOT EXISTS institution.infrastructure_repair_logs (
    "id"                     UUID           NOT NULL DEFAULT uuid_generate_v4(),
    "tenant_id"              UUID           NOT NULL,
    "institution_id"         UUID           NOT NULL,
    "infrastructure_item_id" UUID           NOT NULL,
    "repair_date"            DATE           NOT NULL,
    "notes"                  TEXT           NOT NULL,
    "condition_after"        VARCHAR(100)   NOT NULL,
    "cost"                   DECIMAL(12, 2),
    "created_at"             TIMESTAMP      NOT NULL DEFAULT NOW(),
    "updated_at"             TIMESTAMP      NOT NULL DEFAULT NOW(),

    CONSTRAINT "infrastructure_repair_logs_pkey" PRIMARY KEY ("id")
);

CREATE INDEX IF NOT EXISTS "infrastructure_repair_logs_tenant_item_idx"
    ON institution.infrastructure_repair_logs ("tenant_id", "infrastructure_item_id");
CREATE INDEX IF NOT EXISTS "infrastructure_repair_logs_tenant_institution_idx"
    ON institution.infrastructure_repair_logs ("tenant_id", "institution_id");

ALTER TABLE institution.infrastructure_repair_logs ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS tenant_isolation_select ON institution.infrastructure_repair_logs;
CREATE POLICY tenant_isolation_select ON institution.infrastructure_repair_logs
    FOR SELECT
    USING (tenant_id = current_setting('app.current_tenant_id')::uuid);

DROP POLICY IF EXISTS tenant_isolation_insert ON institution.infrastructure_repair_logs;
CREATE POLICY tenant_isolation_insert ON institution.infrastructure_repair_logs
    FOR INSERT
    WITH CHECK (tenant_id = current_setting('app.current_tenant_id')::uuid);

DROP POLICY IF EXISTS tenant_isolation_update ON institution.infrastructure_repair_logs;
CREATE POLICY tenant_isolation_update ON institution.infrastructure_repair_logs
    FOR UPDATE
    USING (tenant_id = current_setting('app.current_tenant_id')::uuid)
    WITH CHECK (tenant_id = current_setting('app.current_tenant_id')::uuid);

DROP POLICY IF EXISTS tenant_isolation_delete ON institution.infrastructure_repair_logs;
CREATE POLICY tenant_isolation_delete ON institution.infrastructure_repair_logs
    FOR DELETE
    USING (tenant_id = current_setting('app.current_tenant_id')::uuid);
