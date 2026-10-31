-- Demo library seed (idempotent by fixed UUIDs). Apply after 009_library_schema.sql.
-- W1-DATA-15: ensure demo student exists before student_id loan row (residual FK
-- target; student row shared with parent-portal seed).
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
  VALUES (tid, 'Library demo tenant', 'library-demo', '{}'::jsonb, 'active')
  ON CONFLICT (id) DO NOTHING;

  -- Bind the canonical tenant GUC for the tenant-scoped domain writes below.
  PERFORM set_app_tenant_id(tid::text);

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

  INSERT INTO library_items (
    id, tenant_id, isbn, title, author, copies, available
  ) VALUES
    (
      'd1000000-0000-4000-8000-000000000001',
      tid,
      '978-0-13-468599-1',
      'Introduction to Algorithms',
      'Cormen et al.',
      3,
      3
    ),
    (
      'd1000000-0000-4000-8000-000000000002',
      tid,
      '978-0-26-203384-8',
      'Clean Code',
      'Robert C. Martin',
      2,
      1
    )
  ON CONFLICT (id) DO NOTHING;

  INSERT INTO library_loans (
    id, tenant_id, item_id, patron_user_id, student_id,
    checkout_at, due_at, returned_at, status
  ) VALUES (
    'd1000000-0000-4000-8000-000000000101',
    tid,
    'd1000000-0000-4000-8000-000000000002',
    NULL,
    '00000000-0000-4000-8000-000000000099',
    now() - interval '20 days',
    now() - interval '6 days',
    NULL,
    'overdue'
  ) ON CONFLICT (id) DO NOTHING;

  IF NOT EXISTS (
    SELECT 1 FROM library_items
    WHERE id = 'd1000000-0000-4000-8000-000000000001' AND tenant_id = tid
  ) THEN
    RAISE EXCEPTION 'PRC-L556: 009b_library_seed wrote zero rows for tenant % (RLS no-op or missing tenant GUC)', tid;
  END IF;
END $$;
