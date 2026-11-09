-- Demo hostel seed (idempotent by fixed UUIDs). Apply after 008_hostel_schema.sql.
--
-- PRC-L556 (topic 24): adopt the PR#650 cert-seed pattern — bind the tenant GUC
-- before any write and RAISE on a zero-row RLS no-op (fail closed).
\set ON_ERROR_STOP on

DO $$
DECLARE
  tid UUID := '00000000-0000-4000-8000-000000000001';
BEGIN
  PERFORM set_config('app.platform_admin', '1', true);
  PERFORM set_app_tenant_id(tid::text);

  INSERT INTO hostels (
    id, tenant_id, name, code, address, capacity, status
  ) VALUES (
    'b1000000-0000-4000-8000-000000000001',
    tid,
    'North Hall',
    'NH-01',
    'North Campus Road',
    120,
    'active'
  ) ON CONFLICT (id) DO NOTHING;

  INSERT INTO hostel_blocks (
    id, tenant_id, hostel_id, name, floor
  ) VALUES (
    'b1000000-0000-4000-8000-000000000011',
    tid,
    'b1000000-0000-4000-8000-000000000001',
    'Block A',
    1
  ) ON CONFLICT (id) DO NOTHING;

  INSERT INTO hostel_rooms (
    id, tenant_id, block_id, room_number, capacity
  ) VALUES (
    'b1000000-0000-4000-8000-000000000021',
    tid,
    'b1000000-0000-4000-8000-000000000011',
    '101',
    2
  ) ON CONFLICT (id) DO NOTHING;

  INSERT INTO hostel_beds (
    id, tenant_id, room_id, bed_label, is_available
  ) VALUES
    (
      'b1000000-0000-4000-8000-000000000031',
      tid,
      'b1000000-0000-4000-8000-000000000021',
      'A',
      true
    ),
    (
      'b1000000-0000-4000-8000-000000000032',
      tid,
      'b1000000-0000-4000-8000-000000000021',
      'B',
      true
    )
  ON CONFLICT (id) DO NOTHING;

  IF NOT EXISTS (
    SELECT 1 FROM hostels
    WHERE id = 'b1000000-0000-4000-8000-000000000001' AND tenant_id = tid
  ) THEN
    RAISE EXCEPTION 'PRC-L556: 008b_hostel_seed wrote zero rows for tenant % (RLS no-op or missing tenant GUC)', tid;
  END IF;
END $$;
