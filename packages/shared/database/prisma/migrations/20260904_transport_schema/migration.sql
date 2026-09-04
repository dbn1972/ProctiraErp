-- Phase schema ownership: transport (charter §19)
-- CREATE SCHEMA + tables; bare UUID tenant/cross-domain ids (no cross-schema FKs).

CREATE SCHEMA IF NOT EXISTS transport;
CREATE EXTENSION IF NOT EXISTS "uuid-ossp";

CREATE TABLE IF NOT EXISTS transport.transport_routes (
  id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  tenant_id UUID NOT NULL,
  name VARCHAR(255) NOT NULL,
  description TEXT,
  status VARCHAR(20) NOT NULL DEFAULT 'active',
  start_location VARCHAR(255) NOT NULL,
  end_location VARCHAR(255) NOT NULL,
  distance_km DOUBLE PRECISION,
  estimated_duration_minutes INT,
  operating_days JSONB NOT NULL DEFAULT '[]'::jsonb,
  departure_time VARCHAR(16),
  return_time VARCHAR(16),
  institution_id UUID,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);
CREATE INDEX IF NOT EXISTS transport_routes_tenant_id_status_idx ON transport.transport_routes (tenant_id, status);

CREATE TABLE IF NOT EXISTS transport.route_stops (
  id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  tenant_id UUID NOT NULL,
  route_id UUID NOT NULL,
  name VARCHAR(255) NOT NULL,
  latitude DOUBLE PRECISION,
  longitude DOUBLE PRECISION,
  stop_order INT NOT NULL,
  pickup_time VARCHAR(16),
  dropoff_time VARCHAR(16),
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);
CREATE INDEX IF NOT EXISTS route_stops_tenant_id_route_id_idx ON transport.route_stops (tenant_id, route_id);

CREATE TABLE IF NOT EXISTS transport.vehicles (
  id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  tenant_id UUID NOT NULL,
  registration_number VARCHAR(50) NOT NULL,
  make VARCHAR(100),
  model VARCHAR(100),
  year INT,
  capacity INT NOT NULL,
  status VARCHAR(20) NOT NULL DEFAULT 'active',
  insurance_expiry VARCHAR(32),
  last_service_date VARCHAR(32),
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);
CREATE UNIQUE INDEX IF NOT EXISTS vehicles_tenant_id_registration_number_key ON transport.vehicles (tenant_id, registration_number);

CREATE TABLE IF NOT EXISTS transport.driver_assignments (
  id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  tenant_id UUID NOT NULL,
  vehicle_id UUID NOT NULL,
  driver_id UUID NOT NULL,
  route_id UUID,
  start_date VARCHAR(32) NOT NULL,
  end_date VARCHAR(32),
  is_active BOOLEAN NOT NULL DEFAULT TRUE,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);
CREATE INDEX IF NOT EXISTS driver_assignments_tenant_id_vehicle_id_idx ON transport.driver_assignments (tenant_id, vehicle_id);

CREATE TABLE IF NOT EXISTS transport.student_route_assignments (
  id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  tenant_id UUID NOT NULL,
  student_id UUID NOT NULL,
  route_id UUID NOT NULL,
  stop_id UUID,
  start_date VARCHAR(32) NOT NULL,
  end_date VARCHAR(32),
  is_active BOOLEAN NOT NULL DEFAULT TRUE,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);
CREATE INDEX IF NOT EXISTS student_route_assignments_tenant_id_student_id_idx ON transport.student_route_assignments (tenant_id, student_id);
CREATE INDEX IF NOT EXISTS student_route_assignments_tenant_id_route_id_idx ON transport.student_route_assignments (tenant_id, route_id);

