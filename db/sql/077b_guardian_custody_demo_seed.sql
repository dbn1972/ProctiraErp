-- Demo custody graph for parent portal seed (W1-SEC-03 COMPLETE fail-closed).
-- Applied after 076 when APPLY_SEEDS=1. Idempotent.
-- Household H1 + sole custody for demo student ↔ parent-a.

DO $$ BEGIN
  PERFORM set_config('app.platform_admin', '1', true);
  PERFORM set_config('app.tenant_id', '00000000-0000-4000-8000-000000000001', true);
END $$;

INSERT INTO guardian_households (id, tenant_id, label, status)
VALUES (
  '00000000-0000-4000-8000-000000000101',
  '00000000-0000-4000-8000-000000000001',
  'Demo household',
  'active'
)
ON CONFLICT (id) DO NOTHING;

INSERT INTO guardian_household_members (
  id, tenant_id, household_id, parent_user_id, role, status
) VALUES (
  '00000000-0000-4000-8000-000000000111',
  '00000000-0000-4000-8000-000000000001',
  '00000000-0000-4000-8000-000000000101',
  'parent-a',
  'primary',
  'active'
)
ON CONFLICT (tenant_id, household_id, parent_user_id) DO NOTHING;

INSERT INTO guardian_student_custody (
  id, tenant_id, student_id, household_id, custody_type, status, effective_from
) VALUES (
  '00000000-0000-4000-8000-000000000121',
  '00000000-0000-4000-8000-000000000001',
  '00000000-0000-4000-8000-000000000099',
  '00000000-0000-4000-8000-000000000101',
  'sole',
  'active',
  now()
)
ON CONFLICT (tenant_id, student_id, household_id) DO NOTHING;

UPDATE parent_child_links
SET household_id = '00000000-0000-4000-8000-000000000101',
    updated_at = now()
WHERE tenant_id = '00000000-0000-4000-8000-000000000001'
  AND parent_user_id = 'parent-a'
  AND student_id = '00000000-0000-4000-8000-000000000099'
  AND household_id IS NULL;
