-- Phase 25: Alumni
CREATE SCHEMA IF NOT EXISTS alumni;
CREATE EXTENSION IF NOT EXISTS "uuid-ossp";

CREATE TABLE IF NOT EXISTS alumni.profiles (
  id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  tenant_id UUID NOT NULL,
  student_id UUID,
  institution_id UUID,
  full_name VARCHAR(255) NOT NULL,
  graduation_year DOUBLE PRECISION NOT NULL,
  last_class_name VARCHAR(255),
  email VARCHAR(255),
  phone VARCHAR(255),
  status VARCHAR(255) NOT NULL DEFAULT 'active',
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);
CREATE INDEX IF NOT EXISTS profiles_tenant_id_idx ON alumni.profiles (tenant_id);

CREATE TABLE IF NOT EXISTS alumni.events (
  id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  tenant_id UUID NOT NULL,
  institution_id UUID,
  title VARCHAR(255) NOT NULL,
  event_date VARCHAR(255) NOT NULL,
  location VARCHAR(255),
  status VARCHAR(255) NOT NULL DEFAULT 'scheduled',
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);
CREATE INDEX IF NOT EXISTS events_tenant_id_idx ON alumni.events (tenant_id);

