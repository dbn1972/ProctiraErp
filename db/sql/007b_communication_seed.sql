-- Demo communication seed (idempotent by fixed UUIDs). Apply after 007_communication_schema.sql.
-- Tenant UUID matches transport seed / local cert fixtures.

INSERT INTO comms_campaigns (
  id, tenant_id, name, status, channels, body, audience_json, created_by
) VALUES (
  'c1000000-0000-4000-8000-000000000001',
  '00000000-0000-4000-8000-000000000001',
  'Term opening notice',
  'draft',
  ARRAY['email','in_app'],
  'Welcome back — term begins Monday. Check the portal for your timetable.',
  '{"scope":"all"}'::jsonb,
  'seed-officer'
) ON CONFLICT (id) DO NOTHING;

INSERT INTO comms_emergency_blasts (
  id, tenant_id, reason, channels, status, created_by
) VALUES (
  'c1000000-0000-4000-8000-000000000101',
  '00000000-0000-4000-8000-000000000001',
  'Campus closure drill — do not dismiss students until all-clear.',
  ARRAY['sms','push','in_app'],
  'pending_confirm',
  'seed-officer'
) ON CONFLICT (id) DO NOTHING;
