-- Demo seed for parent portal (tenant 00000000-0000-4000-8000-000000000001).
-- Parent user `parent-a` linked to demo student; open fee + pending consent.
-- W1-DATA-15: insert the demo student before UUID cross-refs (FK-enforced).
--
-- PRC-L556 (topic 24): adopt the PR#650 cert-seed pattern. The tenant/student
-- bootstrap runs under the platform-admin scope; bind the canonical tenant GUC
-- before the tenant-owned domain writes and RAISE on a zero-row RLS no-op.
\set ON_ERROR_STOP on

DO $$
DECLARE
  tid UUID := '00000000-0000-4000-8000-000000000001';
BEGIN
  PERFORM set_config('app.platform_admin', '1', true);

  INSERT INTO tenants (id, name, slug, config, status)
  VALUES (tid, 'Parent portal demo tenant', 'parent-portal-demo', '{}'::jsonb, 'active')
  ON CONFLICT (id) DO NOTHING;

  INSERT INTO students (
    id, tenant_id, first_name, last_name, date_of_birth, gender
  ) VALUES (
    '00000000-0000-4000-8000-000000000099',
    tid,
    'Demo',
    'Student',
    DATE '2012-06-15',
    'unspecified'
  ) ON CONFLICT (id) DO NOTHING;

  -- Bind the canonical tenant GUC for the tenant-scoped domain writes below.
  PERFORM set_app_tenant_id(tid::text);

  INSERT INTO parent_child_links (
    id, tenant_id, parent_user_id, student_id, relationship, status
  ) VALUES (
    'e1000000-0000-4000-8000-000000000001',
    tid,
    'parent-a',
    '00000000-0000-4000-8000-000000000099',
    'guardian',
    'active'
  ) ON CONFLICT DO NOTHING;

  INSERT INTO parent_consents (
    id, tenant_id, student_id, parent_user_id, consent_type, title, description, status,
    consent_version, consent_chain_id, version, supersedes_id, valid_from, created_by
  ) VALUES (
    'e2000000-0000-4000-8000-000000000001',
    tid,
    '00000000-0000-4000-8000-000000000099',
    'parent-a',
    'photo_media',
    'School photo & media consent',
    'Allow the school to use your child''s image in yearbooks and newsletters.',
    'pending',
    'photo-media-v2026-01',
    'e2000000-0000-4000-8000-000000000001',
    1,
    NULL,
    now(),
    'staff-admin'
  ) ON CONFLICT DO NOTHING;

  INSERT INTO parent_fee_invoices (
    id, tenant_id, student_id, title, description, amount_cents, currency, status, due_at, created_by
  ) VALUES (
    'e3000000-0000-4000-8000-000000000001',
    tid,
    '00000000-0000-4000-8000-000000000099',
    'Term 1 tuition',
    'Sandbox invoice for parent portal fee pay demo.',
    2500000,
    'INR',
    'open',
    now() + interval '14 days',
    'staff-admin'
  ) ON CONFLICT DO NOTHING;

  INSERT INTO parent_message_threads (
    id, tenant_id, student_id, subject, created_by, status
  ) VALUES (
    'e4000000-0000-4000-8000-000000000001',
    tid,
    '00000000-0000-4000-8000-000000000099',
    'Welcome to the parent portal',
    'staff-admin',
    'open'
  ) ON CONFLICT DO NOTHING;

  INSERT INTO parent_messages (
    id, thread_id, tenant_id, sender_user_id, sender_role, body
  ) VALUES (
    'e5000000-0000-4000-8000-000000000001',
    'e4000000-0000-4000-8000-000000000001',
    tid,
    'staff-admin',
    'staff',
    'You can message the school, approve consent requests, and pay fees here.'
  ) ON CONFLICT DO NOTHING;

  IF NOT EXISTS (
    SELECT 1 FROM parent_consents
    WHERE id = 'e2000000-0000-4000-8000-000000000001' AND tenant_id = tid
  ) THEN
    RAISE EXCEPTION 'PRC-L556: 010b_parent_portal_seed wrote zero rows for tenant % (RLS no-op or missing tenant GUC)', tid;
  END IF;
END $$;
