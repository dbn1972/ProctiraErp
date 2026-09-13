-- Demo seed for parent portal (tenant 00000000-0000-4000-8000-000000000001).
-- Parent user `parent-a` linked to demo student; open fee + pending consent.

INSERT INTO parent_child_links (
  id, tenant_id, parent_user_id, student_id, relationship, status
) VALUES (
  'e1000000-0000-4000-8000-000000000001',
  '00000000-0000-4000-8000-000000000001',
  'parent-a',
  '00000000-0000-4000-8000-000000000099',
  'guardian',
  'active'
) ON CONFLICT DO NOTHING;

INSERT INTO parent_consents (
  id, tenant_id, student_id, parent_user_id, consent_type, title, description, status,
  consent_version, created_by
) VALUES (
  'e2000000-0000-4000-8000-000000000001',
  '00000000-0000-4000-8000-000000000001',
  '00000000-0000-4000-8000-000000000099',
  'parent-a',
  'photo_media',
  'School photo & media consent',
  'Allow the school to use your child''s image in yearbooks and newsletters.',
  'pending',
  'photo-media-v2026-01',
  'staff-admin'
) ON CONFLICT DO NOTHING;

INSERT INTO parent_fee_invoices (
  id, tenant_id, student_id, title, description, amount_cents, currency, status, due_at, created_by
) VALUES (
  'e3000000-0000-4000-8000-000000000001',
  '00000000-0000-4000-8000-000000000001',
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
  '00000000-0000-4000-8000-000000000001',
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
  '00000000-0000-4000-8000-000000000001',
  'staff-admin',
  'staff',
  'You can message the school, approve consent requests, and pay fees here.'
) ON CONFLICT DO NOTHING;
