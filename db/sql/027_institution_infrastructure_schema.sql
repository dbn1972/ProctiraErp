-- Institution infrastructure hierarchy (Wave 9 / G-901): land → building → floor → room
-- plus configurable condition options. Raw SQL — no Prisma. Applied after 026 via
-- tools/scripts/apply-sql.sh.
--
-- Before G-901 the infrastructure store existed only in memory and its routes were
-- not mounted on the gateway. Rows are tenant-bound (RLS on tenant_id) and scoped to
-- an institution (school). institution_id is not FK-constrained here because the
-- institutions table is Prisma-managed and CI applies Prisma migrations first but
-- test tenants may not seed institutions; application code validates the id.

CREATE TABLE IF NOT EXISTS institution_infrastructure (
  id UUID PRIMARY KEY,
  tenant_id UUID NOT NULL,
  institution_id UUID NOT NULL,
  parent_id UUID REFERENCES institution_infrastructure(id) ON DELETE RESTRICT,
  type TEXT NOT NULL CHECK (type IN ('LAND', 'BUILDING', 'FLOOR', 'ROOM')),
  name TEXT NOT NULL,
  capacity INTEGER NOT NULL DEFAULT 0 CHECK (capacity >= 0),
  condition TEXT NOT NULL,
  description TEXT,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS institution_infrastructure_tenant_institution_type_idx
  ON institution_infrastructure (tenant_id, institution_id, type);
CREATE INDEX IF NOT EXISTS institution_infrastructure_parent_idx
  ON institution_infrastructure (tenant_id, parent_id);

CREATE TABLE IF NOT EXISTS institution_condition_options (
  id UUID PRIMARY KEY,
  tenant_id UUID NOT NULL,
  name TEXT NOT NULL,
  description TEXT,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  UNIQUE (tenant_id, name)
);

-- ---------------------------------------------------------------------------
-- RLS (same policy shape as 015; tenant bound via withPgTenant / app.tenant_id)
-- ---------------------------------------------------------------------------
ALTER TABLE institution_infrastructure ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS tenant_isolation ON institution_infrastructure;
CREATE POLICY tenant_isolation ON institution_infrastructure
  FOR ALL
  USING (tenant_id::text = NULLIF(current_setting('app.tenant_id', true), ''))
  WITH CHECK (tenant_id::text = NULLIF(current_setting('app.tenant_id', true), ''));

ALTER TABLE institution_condition_options ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS tenant_isolation ON institution_condition_options;
CREATE POLICY tenant_isolation ON institution_condition_options
  FOR ALL
  USING (tenant_id::text = NULLIF(current_setting('app.tenant_id', true), ''))
  WITH CHECK (tenant_id::text = NULLIF(current_setting('app.tenant_id', true), ''));

ALTER TABLE institution_infrastructure FORCE ROW LEVEL SECURITY;
ALTER TABLE institution_condition_options FORCE ROW LEVEL SECURITY;
