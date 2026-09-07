-- Demo hostel seed (idempotent by fixed UUIDs). Apply after 008_hostel_schema.sql.

INSERT INTO hostels (
  id, tenant_id, name, code, address, capacity, status
) VALUES (
  'b1000000-0000-4000-8000-000000000001',
  '00000000-0000-4000-8000-000000000001',
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
  '00000000-0000-4000-8000-000000000001',
  'b1000000-0000-4000-8000-000000000001',
  'Block A',
  1
) ON CONFLICT (id) DO NOTHING;

INSERT INTO hostel_rooms (
  id, tenant_id, block_id, room_number, capacity
) VALUES (
  'b1000000-0000-4000-8000-000000000021',
  '00000000-0000-4000-8000-000000000001',
  'b1000000-0000-4000-8000-000000000011',
  '101',
  2
) ON CONFLICT (id) DO NOTHING;

INSERT INTO hostel_beds (
  id, tenant_id, room_id, bed_label, is_available
) VALUES
  (
    'b1000000-0000-4000-8000-000000000031',
    '00000000-0000-4000-8000-000000000001',
    'b1000000-0000-4000-8000-000000000021',
    'A',
    true
  ),
  (
    'b1000000-0000-4000-8000-000000000032',
    '00000000-0000-4000-8000-000000000001',
    'b1000000-0000-4000-8000-000000000021',
    'B',
    true
  )
ON CONFLICT (id) DO NOTHING;
