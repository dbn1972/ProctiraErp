-- Transport ops (Wave 9 / G-920): GPS ingest, bus attendance, alert rules,
-- transport fee bands. Applied after 006_transport_schema.sql via
-- tools/scripts/apply-sql.sh (numeric order).
--
-- RLS: tenant bound via withPgTenant / app.tenant_id (same policy shape as 036).

-- ---------------------------------------------------------------------------
-- Vehicle GPS devices (plaintext key is never stored)
-- ---------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS transport_vehicle_devices (
  id UUID PRIMARY KEY,
  tenant_id UUID NOT NULL,
  vehicle_id UUID NOT NULL REFERENCES transport_vehicles(id) ON DELETE CASCADE,
  device_id TEXT NOT NULL,
  device_key_hash TEXT NOT NULL,
  is_active BOOLEAN NOT NULL DEFAULT true,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  UNIQUE (tenant_id, device_id),
  UNIQUE (tenant_id, vehicle_id)
);
CREATE INDEX IF NOT EXISTS transport_vehicle_devices_vehicle_idx
  ON transport_vehicle_devices (tenant_id, vehicle_id);

-- ---------------------------------------------------------------------------
-- GPS pings (idempotent by tenant + device_id + ping_id)
-- ---------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS transport_gps_pings (
  id UUID PRIMARY KEY,
  tenant_id UUID NOT NULL,
  vehicle_id UUID NOT NULL REFERENCES transport_vehicles(id) ON DELETE CASCADE,
  device_id TEXT NOT NULL,
  ping_id TEXT NOT NULL,
  latitude DOUBLE PRECISION NOT NULL CHECK (latitude >= -90 AND latitude <= 90),
  longitude DOUBLE PRECISION NOT NULL CHECK (longitude >= -180 AND longitude <= 180),
  recorded_at TIMESTAMPTZ NOT NULL,
  speed_kph DOUBLE PRECISION,
  heading_deg DOUBLE PRECISION,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  UNIQUE (tenant_id, device_id, ping_id)
);
CREATE INDEX IF NOT EXISTS transport_gps_pings_vehicle_idx
  ON transport_gps_pings (tenant_id, vehicle_id, recorded_at DESC);

-- ---------------------------------------------------------------------------
-- Bus attendance per trip (route × date × direction × student)
-- ---------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS transport_bus_attendance (
  id UUID PRIMARY KEY,
  tenant_id UUID NOT NULL,
  route_id UUID NOT NULL REFERENCES transport_routes(id) ON DELETE CASCADE,
  trip_date DATE NOT NULL,
  direction TEXT NOT NULL CHECK (direction IN ('pickup', 'drop')),
  student_id UUID NOT NULL,
  stop_id UUID REFERENCES transport_stops(id) ON DELETE SET NULL,
  status TEXT NOT NULL CHECK (status IN ('boarded', 'alighted', 'absent')),
  recorded_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  recorded_by TEXT,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  UNIQUE (tenant_id, route_id, trip_date, direction, student_id)
);
CREATE INDEX IF NOT EXISTS transport_bus_attendance_trip_idx
  ON transport_bus_attendance (tenant_id, route_id, trip_date, direction);

-- ---------------------------------------------------------------------------
-- Alert rules + produced alerts
-- ---------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS transport_alert_rules (
  id UUID PRIMARY KEY,
  tenant_id UUID NOT NULL,
  kind TEXT NOT NULL CHECK (kind IN ('delay_minutes', 'geofence_exit', 'missed_pickup')),
  threshold NUMERIC NOT NULL CHECK (threshold >= 0),
  channels TEXT[] NOT NULL DEFAULT '{}',
  route_id UUID REFERENCES transport_routes(id) ON DELETE SET NULL,
  is_active BOOLEAN NOT NULL DEFAULT true,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS transport_alert_rules_tenant_idx
  ON transport_alert_rules (tenant_id, kind, is_active);

CREATE TABLE IF NOT EXISTS transport_alerts (
  id UUID PRIMARY KEY,
  tenant_id UUID NOT NULL,
  rule_id UUID NOT NULL REFERENCES transport_alert_rules(id) ON DELETE CASCADE,
  kind TEXT NOT NULL CHECK (kind IN ('delay_minutes', 'geofence_exit', 'missed_pickup')),
  vehicle_id UUID,
  route_id UUID,
  student_id UUID,
  message TEXT NOT NULL,
  payload JSONB NOT NULL DEFAULT '{}'::jsonb,
  acknowledged_at TIMESTAMPTZ,
  acknowledged_by TEXT,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS transport_alerts_tenant_idx
  ON transport_alerts (tenant_id, created_at DESC);

-- ---------------------------------------------------------------------------
-- Transport fee bands (linked to G-903 fee_structures when FeesService is wired)
-- ---------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS transport_fee_structures (
  id UUID PRIMARY KEY,
  tenant_id UUID NOT NULL,
  name TEXT NOT NULL,
  route_id UUID REFERENCES transport_routes(id) ON DELETE SET NULL,
  stop_id UUID REFERENCES transport_stops(id) ON DELETE SET NULL,
  min_distance_km DOUBLE PRECISION,
  max_distance_km DOUBLE PRECISION,
  amount_cents INTEGER NOT NULL CHECK (amount_cents >= 0),
  currency TEXT NOT NULL DEFAULT 'INR',
  fees_structure_id UUID,
  is_active BOOLEAN NOT NULL DEFAULT true,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS transport_fee_structures_route_idx
  ON transport_fee_structures (tenant_id, route_id, stop_id);

CREATE TABLE IF NOT EXISTS transport_fee_links (
  id UUID PRIMARY KEY,
  tenant_id UUID NOT NULL,
  assignment_id UUID NOT NULL REFERENCES transport_student_assignments(id) ON DELETE CASCADE,
  student_id UUID NOT NULL,
  transport_fee_structure_id UUID REFERENCES transport_fee_structures(id) ON DELETE SET NULL,
  fees_invoice_id UUID,
  fees_structure_id UUID,
  status TEXT NOT NULL CHECK (status IN ('invoiced', 'pending', 'skipped')),
  reason TEXT,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS transport_fee_links_assignment_idx
  ON transport_fee_links (tenant_id, assignment_id);

-- ---------------------------------------------------------------------------
-- RLS (same policy shape as 027/030/036; tenant bound via withPgTenant)
-- ---------------------------------------------------------------------------
ALTER TABLE transport_vehicle_devices ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS tenant_isolation ON transport_vehicle_devices;
CREATE POLICY tenant_isolation ON transport_vehicle_devices
  FOR ALL
  USING (tenant_id::text = NULLIF(current_setting('app.tenant_id', true), ''))
  WITH CHECK (tenant_id::text = NULLIF(current_setting('app.tenant_id', true), ''));
ALTER TABLE transport_vehicle_devices FORCE ROW LEVEL SECURITY;

ALTER TABLE transport_gps_pings ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS tenant_isolation ON transport_gps_pings;
CREATE POLICY tenant_isolation ON transport_gps_pings
  FOR ALL
  USING (tenant_id::text = NULLIF(current_setting('app.tenant_id', true), ''))
  WITH CHECK (tenant_id::text = NULLIF(current_setting('app.tenant_id', true), ''));
ALTER TABLE transport_gps_pings FORCE ROW LEVEL SECURITY;

ALTER TABLE transport_bus_attendance ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS tenant_isolation ON transport_bus_attendance;
CREATE POLICY tenant_isolation ON transport_bus_attendance
  FOR ALL
  USING (tenant_id::text = NULLIF(current_setting('app.tenant_id', true), ''))
  WITH CHECK (tenant_id::text = NULLIF(current_setting('app.tenant_id', true), ''));
ALTER TABLE transport_bus_attendance FORCE ROW LEVEL SECURITY;

ALTER TABLE transport_alert_rules ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS tenant_isolation ON transport_alert_rules;
CREATE POLICY tenant_isolation ON transport_alert_rules
  FOR ALL
  USING (tenant_id::text = NULLIF(current_setting('app.tenant_id', true), ''))
  WITH CHECK (tenant_id::text = NULLIF(current_setting('app.tenant_id', true), ''));
ALTER TABLE transport_alert_rules FORCE ROW LEVEL SECURITY;

ALTER TABLE transport_alerts ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS tenant_isolation ON transport_alerts;
CREATE POLICY tenant_isolation ON transport_alerts
  FOR ALL
  USING (tenant_id::text = NULLIF(current_setting('app.tenant_id', true), ''))
  WITH CHECK (tenant_id::text = NULLIF(current_setting('app.tenant_id', true), ''));
ALTER TABLE transport_alerts FORCE ROW LEVEL SECURITY;

ALTER TABLE transport_fee_structures ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS tenant_isolation ON transport_fee_structures;
CREATE POLICY tenant_isolation ON transport_fee_structures
  FOR ALL
  USING (tenant_id::text = NULLIF(current_setting('app.tenant_id', true), ''))
  WITH CHECK (tenant_id::text = NULLIF(current_setting('app.tenant_id', true), ''));
ALTER TABLE transport_fee_structures FORCE ROW LEVEL SECURITY;

ALTER TABLE transport_fee_links ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS tenant_isolation ON transport_fee_links;
CREATE POLICY tenant_isolation ON transport_fee_links
  FOR ALL
  USING (tenant_id::text = NULLIF(current_setting('app.tenant_id', true), ''))
  WITH CHECK (tenant_id::text = NULLIF(current_setting('app.tenant_id', true), ''));
ALTER TABLE transport_fee_links FORCE ROW LEVEL SECURITY;
