-- Demo communication seed (idempotent by fixed UUIDs). Apply after 007_communication_schema.sql.
-- Tenant UUID matches transport seed / local cert fixtures.
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

  INSERT INTO comms_campaigns (
    id, tenant_id, name, status, channels, body, audience_json, created_by
  ) VALUES (
    'c1000000-0000-4000-8000-000000000001',
    tid,
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
    tid,
    'Campus closure drill — do not dismiss students until all-clear.',
    ARRAY['sms','push','in_app'],
    'pending_confirm',
    'seed-officer'
  ) ON CONFLICT (id) DO NOTHING;

  IF NOT EXISTS (
    SELECT 1 FROM comms_campaigns
    WHERE id = 'c1000000-0000-4000-8000-000000000001' AND tenant_id = tid
  ) THEN
    RAISE EXCEPTION 'PRC-L556: 007b_communication_seed wrote zero rows for tenant % (RLS no-op or missing tenant GUC)', tid;
  END IF;
END $$;
