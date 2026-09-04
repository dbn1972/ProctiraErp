-- Phase 21: Hostel
CREATE SCHEMA IF NOT EXISTS hostel;
CREATE EXTENSION IF NOT EXISTS "uuid-ossp";

CREATE TABLE IF NOT EXISTS hostel.hostels (
  id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  tenant_id UUID NOT NULL,
  institution_id UUID NOT NULL,
  name VARCHAR(255) NOT NULL,
  gender VARCHAR(255) NOT NULL DEFAULT 'mixed',
  capacity DOUBLE PRECISION NOT NULL,
  status VARCHAR(255) NOT NULL DEFAULT 'active',
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);
CREATE INDEX IF NOT EXISTS hostels_tenant_id_idx ON hostel.hostels (tenant_id);

CREATE TABLE IF NOT EXISTS hostel.rooms (
  id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  tenant_id UUID NOT NULL,
  hostel_id UUID NOT NULL,
  name VARCHAR(255) NOT NULL,
  beds DOUBLE PRECISION NOT NULL,
  status VARCHAR(255) NOT NULL DEFAULT 'available',
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);
CREATE INDEX IF NOT EXISTS rooms_tenant_id_idx ON hostel.rooms (tenant_id);

CREATE TABLE IF NOT EXISTS hostel.allocations (
  id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  tenant_id UUID NOT NULL,
  hostel_id UUID NOT NULL,
  room_id UUID NOT NULL,
  student_id UUID NOT NULL,
  start_date VARCHAR(255) NOT NULL,
  end_date VARCHAR(255),
  fee_invoice_id UUID,
  status VARCHAR(255) NOT NULL DEFAULT 'active',
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);
CREATE INDEX IF NOT EXISTS allocations_tenant_id_idx ON hostel.allocations (tenant_id);

