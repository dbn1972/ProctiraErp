-- Transport module (raw SQL — no Prisma).
-- Aligned with TransportRepository entity shapes.

CREATE TABLE IF NOT EXISTS transport_routes (
  id UUID PRIMARY KEY,
  tenant_id UUID NOT NULL,
  name TEXT NOT NULL,
  description TEXT,
  status TEXT NOT NULL DEFAULT 'active'
    CHECK (status IN ('active', 'inactive', 'suspended')),
  start_location TEXT NOT NULL,
  end_location TEXT NOT NULL,
  distance_km DOUBLE PRECISION,
  estimated_duration_minutes INT,
  operating_days TEXT[] NOT NULL DEFAULT '{}',
  departure_time TEXT,
  return_time TEXT,
  institution_id UUID,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_transport_routes_tenant
  ON transport_routes (tenant_id, status);

CREATE TABLE IF NOT EXISTS transport_stops (
  id UUID PRIMARY KEY,
  tenant_id UUID NOT NULL,
  route_id UUID NOT NULL REFERENCES transport_routes(id) ON DELETE CASCADE,
  name TEXT NOT NULL,
  latitude DOUBLE PRECISION,
  longitude DOUBLE PRECISION,
  stop_order INT NOT NULL,
  pickup_time TEXT,
  dropoff_time TEXT,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  UNIQUE (route_id, stop_order)
);

CREATE INDEX IF NOT EXISTS idx_transport_stops_route
  ON transport_stops (tenant_id, route_id);

CREATE TABLE IF NOT EXISTS transport_vehicles (
  id UUID PRIMARY KEY,
  tenant_id UUID NOT NULL,
  registration_number TEXT NOT NULL,
  make TEXT,
  model TEXT,
  year INT,
  capacity INT NOT NULL DEFAULT 1,
  status TEXT NOT NULL DEFAULT 'active'
    CHECK (status IN ('active', 'inactive', 'maintenance', 'retired')),
  insurance_expiry TEXT,
  last_service_date TEXT,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  UNIQUE (tenant_id, registration_number)
);

CREATE INDEX IF NOT EXISTS idx_transport_vehicles_tenant
  ON transport_vehicles (tenant_id, status);

CREATE TABLE IF NOT EXISTS transport_driver_assignments (
  id UUID PRIMARY KEY,
  tenant_id UUID NOT NULL,
  vehicle_id UUID NOT NULL REFERENCES transport_vehicles(id),
  driver_id UUID NOT NULL,
  route_id UUID REFERENCES transport_routes(id),
  start_date DATE NOT NULL,
  end_date DATE,
  is_active BOOLEAN NOT NULL DEFAULT true,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_transport_driver_assignments_tenant
  ON transport_driver_assignments (tenant_id, vehicle_id);

CREATE TABLE IF NOT EXISTS transport_student_assignments (
  id UUID PRIMARY KEY,
  tenant_id UUID NOT NULL,
  student_id UUID NOT NULL,
  route_id UUID NOT NULL REFERENCES transport_routes(id),
  stop_id UUID REFERENCES transport_stops(id),
  start_date DATE NOT NULL,
  end_date DATE,
  is_active BOOLEAN NOT NULL DEFAULT true,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_transport_student_assignments_tenant
  ON transport_student_assignments (tenant_id, student_id);
