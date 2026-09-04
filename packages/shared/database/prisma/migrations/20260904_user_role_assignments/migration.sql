-- Auth membership projection for role/area/institution recipient targeting.
-- Bare UUID refs only — no cross-schema FKs (charter §19).

CREATE EXTENSION IF NOT EXISTS "uuid-ossp";

CREATE TABLE IF NOT EXISTS auth.user_role_assignments (
  id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  tenant_id UUID NOT NULL,
  user_id UUID NOT NULL,
  role_id UUID NOT NULL,
  area_id UUID,
  institution_id UUID,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS user_role_assignments_tenant_id_role_id_idx
  ON auth.user_role_assignments (tenant_id, role_id);
CREATE INDEX IF NOT EXISTS user_role_assignments_tenant_id_area_id_idx
  ON auth.user_role_assignments (tenant_id, area_id);
CREATE INDEX IF NOT EXISTS user_role_assignments_tenant_id_institution_id_idx
  ON auth.user_role_assignments (tenant_id, institution_id);
CREATE INDEX IF NOT EXISTS user_role_assignments_tenant_id_user_id_idx
  ON auth.user_role_assignments (tenant_id, user_id);

-- Nullable area/institution: coalesce to zero UUID so the unique key is stable.
CREATE UNIQUE INDEX IF NOT EXISTS user_role_assignments_tenant_user_role_scope_key
  ON auth.user_role_assignments (
    tenant_id,
    user_id,
    role_id,
    COALESCE(area_id, '00000000-0000-0000-0000-000000000000'::uuid),
    COALESCE(institution_id, '00000000-0000-0000-0000-000000000000'::uuid)
  );
