-- Demo library seed (idempotent by fixed UUIDs). Apply after 009_library_schema.sql.
-- W1-DATA-15: ensure demo student exists before student_id loan row (residual FK
-- target; student row shared with parent-portal seed).

DO $$ BEGIN
  PERFORM set_config('app.platform_admin', '1', true);
END $$;

INSERT INTO tenants (id, name, slug, config, status)
VALUES (
  '00000000-0000-4000-8000-000000000001',
  'Library demo tenant',
  'library-demo',
  '{}'::jsonb,
  'active'
)
ON CONFLICT (id) DO NOTHING;

INSERT INTO students (
  id, tenant_id, first_name, last_name, date_of_birth, gender
) VALUES (
  '00000000-0000-4000-8000-000000000099',
  '00000000-0000-4000-8000-000000000001',
  'Demo',
  'Student',
  DATE '2012-06-15',
  'unspecified'
)
ON CONFLICT (id) DO NOTHING;

INSERT INTO library_items (
  id, tenant_id, isbn, title, author, copies, available
) VALUES
  (
    'd1000000-0000-4000-8000-000000000001',
    '00000000-0000-4000-8000-000000000001',
    '978-0-13-468599-1',
    'Introduction to Algorithms',
    'Cormen et al.',
    3,
    3
  ),
  (
    'd1000000-0000-4000-8000-000000000002',
    '00000000-0000-4000-8000-000000000001',
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
  '00000000-0000-4000-8000-000000000001',
  'd1000000-0000-4000-8000-000000000002',
  NULL,
  '00000000-0000-4000-8000-000000000099',
  now() - interval '20 days',
  now() - interval '6 days',
  NULL,
  'overdue'
) ON CONFLICT (id) DO NOTHING;
