-- Registration form configuration persistence (Req 16.1).
-- Bare UUID tenant_id — no cross-schema FKs (charter §19).

CREATE EXTENSION IF NOT EXISTS "uuid-ossp";

CREATE TABLE IF NOT EXISTS registration.form_configurations (
  id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  tenant_id UUID NOT NULL,
  institution_type_id VARCHAR(100) NOT NULL,
  fields JSONB NOT NULL DEFAULT '[]'::jsonb,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE UNIQUE INDEX IF NOT EXISTS form_configurations_tenant_id_institution_type_id_key
  ON registration.form_configurations (tenant_id, institution_type_id);
CREATE INDEX IF NOT EXISTS form_configurations_tenant_id_idx
  ON registration.form_configurations (tenant_id);
