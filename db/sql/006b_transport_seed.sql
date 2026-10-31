-- Demo transport seed (idempotent by fixed UUIDs). Apply after 006_transport_schema.sql.
-- Tenant UUID matches common local/dev JWT claim when using cert fixtures.
--
-- PRC-L556 (topic 24): adopt the PR#650 cert-seed pattern. Bind the tenant GUC
-- (platform scope + canonical app.tenant_id) before any domain-table write so
-- RLS does not silently filter these inserts to zero rows under the
-- non-superuser runtime role, and RAISE on a zero-row RLS no-op so a filtered
-- apply fails closed instead of recording an empty seed.
\set ON_ERROR_STOP on

DO $$
DECLARE
  tid UUID := '00000000-0000-4000-8000-000000000001';
BEGIN
  PERFORM set_config('app.platform_admin', '1', true);
  PERFORM set_app_tenant_id(tid::text);

  INSERT INTO transport_routes (
    id, tenant_id, name, description, status,
    start_location, end_location, distance_km, estimated_duration_minutes,
    operating_days, departure_time, return_time
  ) VALUES (
    'a1000000-0000-4000-8000-000000000001',
    tid,
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
    tid,
    'MH-12-AB-1234',
    'Tata',
    'Starbus',
    2022,
    40,
    'active'
  ) ON CONFLICT (id) DO NOTHING;

  -- PRC-L556: fail closed on a zero-row RLS no-op. Under FORCE RLS as the
  -- runtime role without the tenant GUC bound, the inserts above are silently
  -- filtered; the rows must be visible/present for this tenant afterwards.
  IF NOT EXISTS (
    SELECT 1 FROM transport_routes
    WHERE id = 'a1000000-0000-4000-8000-000000000001' AND tenant_id = tid
  ) THEN
    RAISE EXCEPTION 'PRC-L556: 006b_transport_seed wrote zero rows for tenant % (RLS no-op or missing tenant GUC)', tid;
  END IF;
END $$;
