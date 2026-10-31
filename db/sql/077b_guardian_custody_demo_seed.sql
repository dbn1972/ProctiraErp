-- Demo custody graph for parent portal seed (W1-SEC-03 COMPLETE fail-closed).
-- Applied after 076 when APPLY_SEEDS=1. Idempotent.
-- Household H1 + sole custody for demo student ↔ parent-a.
--
-- PRC-L556 (topic 24): adopt the PR#650 cert-seed pattern — bind the canonical
-- tenant GUC (set_app_tenant_id) under the platform scope and RAISE on a
-- zero-row RLS no-op so a filtered apply fails closed.
\set ON_ERROR_STOP on

DO $$
DECLARE
  tid UUID := '00000000-0000-4000-8000-000000000001';
BEGIN
  PERFORM set_config('app.platform_admin', '1', true);
  PERFORM set_app_tenant_id(tid::text);

  INSERT INTO guardian_households (id, tenant_id, label, status)
  VALUES (
    '00000000-0000-4000-8000-000000000101',
    tid,
    'Demo household',
    'active'
  )
  ON CONFLICT (id) DO NOTHING;

  INSERT INTO guardian_household_members (
    id, tenant_id, household_id, parent_user_id, role, status
  ) VALUES (
    '00000000-0000-4000-8000-000000000111',
    tid,
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
    tid,
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
  WHERE tenant_id = tid
    AND parent_user_id = 'parent-a'
    AND student_id = '00000000-0000-4000-8000-000000000099'
    AND household_id IS NULL;

  IF NOT EXISTS (
    SELECT 1 FROM guardian_households
    WHERE id = '00000000-0000-4000-8000-000000000101' AND tenant_id = tid
  ) THEN
    RAISE EXCEPTION 'PRC-L556: 077b_guardian_custody_demo_seed wrote zero rows for tenant % (RLS no-op or missing tenant GUC)', tid;
  END IF;
END $$;
