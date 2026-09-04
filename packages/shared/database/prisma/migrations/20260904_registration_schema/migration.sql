-- Phase schema ownership: registration (charter §19)
-- CREATE SCHEMA + tables; bare UUID tenant/cross-domain ids (no cross-schema FKs).

CREATE SCHEMA IF NOT EXISTS registration;
CREATE EXTENSION IF NOT EXISTS "uuid-ossp";

CREATE TABLE IF NOT EXISTS registration.registration_applications (
  id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  tenant_id UUID NOT NULL,
  tracking_number VARCHAR(50) NOT NULL,
  institution_id UUID NOT NULL,
  institution_name VARCHAR(255) NOT NULL,
  status VARCHAR(30) NOT NULL,
  first_name VARCHAR(100) NOT NULL,
  last_name VARCHAR(100) NOT NULL,
  date_of_birth VARCHAR(32) NOT NULL,
  gender VARCHAR(20) NOT NULL,
  guardian_name VARCHAR(255) NOT NULL,
  guardian_phone VARCHAR(50) NOT NULL,
  guardian_email VARCHAR(255),
  custom_fields JSONB NOT NULL DEFAULT '[]'::jsonb,
  documents JSONB NOT NULL DEFAULT '[]'::jsonb,
  preferred_language VARCHAR(20),
  remarks TEXT,
  submitted_at TIMESTAMPTZ NOT NULL,
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);
CREATE INDEX IF NOT EXISTS registration_applications_tenant_id_status_idx ON registration.registration_applications (tenant_id, status);
CREATE INDEX IF NOT EXISTS registration_applications_tenant_id_institution_id_idx ON registration.registration_applications (tenant_id, institution_id);
CREATE UNIQUE INDEX IF NOT EXISTS registration_applications_tenant_id_tracking_number_key ON registration.registration_applications (tenant_id, tracking_number);

