-- Institution infrastructure hierarchy (Land → Building → Floor → Room).
-- Tables live in institution schema; tenant_id is a bare UUID (no cross-schema FK).
-- institution_id / parent_id stay in-schema. RLS mirrors other tenant tables.

CREATE EXTENSION IF NOT EXISTS "uuid-ossp";

CREATE TABLE IF NOT EXISTS institution.infrastructure_items (
    "id"             UUID         NOT NULL DEFAULT uuid_generate_v4(),
    "tenant_id"      UUID         NOT NULL,
    "institution_id" UUID         NOT NULL,
    "parent_id"      UUID,
    "name"           VARCHAR(255) NOT NULL,
    "type"           VARCHAR(20)  NOT NULL,
    "capacity"       INTEGER      NOT NULL,
    "condition"      VARCHAR(100) NOT NULL,
    "description"    VARCHAR(500),
    "created_at"     TIMESTAMP    NOT NULL DEFAULT NOW(),
    "updated_at"     TIMESTAMP    NOT NULL DEFAULT NOW(),
    "deleted_at"     TIMESTAMP,

    CONSTRAINT "infrastructure_items_pkey" PRIMARY KEY ("id")
);

ALTER TABLE institution.infrastructure_items
    ADD CONSTRAINT "infrastructure_items_institution_id_fkey"
    FOREIGN KEY ("institution_id") REFERENCES institution.institutions("id");

ALTER TABLE institution.infrastructure_items
    ADD CONSTRAINT "infrastructure_items_parent_id_fkey"
    FOREIGN KEY ("parent_id") REFERENCES institution.infrastructure_items("id");

CREATE INDEX IF NOT EXISTS "infrastructure_items_tenant_institution_type_idx"
    ON institution.infrastructure_items ("tenant_id", "institution_id", "type");
CREATE INDEX IF NOT EXISTS "infrastructure_items_tenant_parent_idx"
    ON institution.infrastructure_items ("tenant_id", "parent_id");

ALTER TABLE institution.infrastructure_items ENABLE ROW LEVEL SECURITY;

CREATE POLICY tenant_isolation_select ON institution.infrastructure_items
    FOR SELECT
    USING (tenant_id = current_setting('app.current_tenant_id')::uuid);

CREATE POLICY tenant_isolation_insert ON institution.infrastructure_items
    FOR INSERT
    WITH CHECK (tenant_id = current_setting('app.current_tenant_id')::uuid);

CREATE POLICY tenant_isolation_update ON institution.infrastructure_items
    FOR UPDATE
    USING (tenant_id = current_setting('app.current_tenant_id')::uuid)
    WITH CHECK (tenant_id = current_setting('app.current_tenant_id')::uuid);

CREATE POLICY tenant_isolation_delete ON institution.infrastructure_items
    FOR DELETE
    USING (tenant_id = current_setting('app.current_tenant_id')::uuid);

CREATE TABLE IF NOT EXISTS institution.infrastructure_condition_options (
    "id"          UUID         NOT NULL DEFAULT uuid_generate_v4(),
    "tenant_id"   UUID         NOT NULL,
    "name"        VARCHAR(100) NOT NULL,
    "description" VARCHAR(500),
    "created_at"  TIMESTAMP    NOT NULL DEFAULT NOW(),
    "updated_at"  TIMESTAMP    NOT NULL DEFAULT NOW(),

    CONSTRAINT "infrastructure_condition_options_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX IF NOT EXISTS "infrastructure_condition_options_tenant_name_key"
    ON institution.infrastructure_condition_options ("tenant_id", "name");
CREATE INDEX IF NOT EXISTS "infrastructure_condition_options_tenant_idx"
    ON institution.infrastructure_condition_options ("tenant_id");

ALTER TABLE institution.infrastructure_condition_options ENABLE ROW LEVEL SECURITY;

CREATE POLICY tenant_isolation_select ON institution.infrastructure_condition_options
    FOR SELECT
    USING (tenant_id = current_setting('app.current_tenant_id')::uuid);

CREATE POLICY tenant_isolation_insert ON institution.infrastructure_condition_options
    FOR INSERT
    WITH CHECK (tenant_id = current_setting('app.current_tenant_id')::uuid);

CREATE POLICY tenant_isolation_update ON institution.infrastructure_condition_options
    FOR UPDATE
    USING (tenant_id = current_setting('app.current_tenant_id')::uuid)
    WITH CHECK (tenant_id = current_setting('app.current_tenant_id')::uuid);

CREATE POLICY tenant_isolation_delete ON institution.infrastructure_condition_options
    FOR DELETE
    USING (tenant_id = current_setting('app.current_tenant_id')::uuid);
