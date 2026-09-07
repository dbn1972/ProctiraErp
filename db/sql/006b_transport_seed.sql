-- Demo transport seed (idempotent by fixed UUIDs). Apply after 006_transport_schema.sql.
-- Tenant UUID matches common local/dev JWT claim when using cert fixtures.

INSERT INTO transport_routes (
  id, tenant_id, name, description, status,
  start_location, end_location, distance_km, estimated_duration_minutes,
  operating_days, departure_time, return_time
) VALUES (
  'a1000000-0000-4000-8000-000000000001',
  '00000000-0000-4000-8000-000000000001',
  'North Campus Loop',
  'Seed route for enterprise demos',
  'active',
  'North Depot',
  'Main Gate',
  12.5,
  45,
  ARRAY['monday','tuesday','wednesday','thursday','friday'],
  '07:15',
  '15:30'
) ON CONFLICT (id) DO NOTHING;

INSERT INTO transport_vehicles (
  id, tenant_id, registration_number, make, model, year, capacity, status
) VALUES (
  'a1000000-0000-4000-8000-000000000101',
  '00000000-0000-4000-8000-000000000001',
  'MH-12-AB-1234',
  'Tata',
  'Starbus',
  2022,
  40,
  'active'
) ON CONFLICT (id) DO NOTHING;
