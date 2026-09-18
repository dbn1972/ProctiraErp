-- =============================================================================
-- E2E tenant fixtures (G-706)
-- =============================================================================
-- The Playwright live smokes (apps/web/e2e/*.spec.ts) mint HS256 cookies for a
-- fixed set of tenant ids. With G-718 strict tenant FKs (APPLY_STRICT_FKS=1)
-- and G-732 FORCE RLS on `tenants`, those ids must exist as real tenant rows
-- before any domain write succeeds. This file is idempotent and applied by
-- tools/scripts/run-e2e-backend-ready.sh before api-gateway starts.
--
-- FORCE RLS: inserting into `tenants` requires the platform-admin scope, bound
-- transaction-locally here so it never leaks into the session.
-- =============================================================================
BEGIN;
DO $$ BEGIN PERFORM set_config('app.platform_admin', '1', true); END $$;

INSERT INTO tenants (id, name, slug, config, status)
VALUES
  ('00000000-0000-4000-8000-000000000001', 'E2E Tenant A (demo)',        'e2e-tenant-a',       '{}'::jsonb, 'active'),
  ('00000000-0000-4000-8000-0000000000aa', 'E2E Tenant AA (health)',     'e2e-tenant-aa',      '{}'::jsonb, 'active'),
  ('00000000-0000-4000-8000-0000000000bb', 'E2E Tenant B (isolation)',   'e2e-tenant-bb',      '{}'::jsonb, 'active'),
  ('00000000-0000-4000-8000-000000000032', 'E2E Tenant 32 (services)',   'e2e-tenant-32',      '{}'::jsonb, 'active'),
  ('00000000-0000-4000-8000-000000000094', 'E2E Tenant 94 (attendance)', 'e2e-tenant-94',      '{}'::jsonb, 'active'),
  ('00000000-0000-4000-8000-000000000096', 'E2E Tenant 96 (staff)',      'e2e-tenant-96',      '{}'::jsonb, 'active'),
  ('00000000-0000-4000-8000-000000000098', 'E2E Tenant 98 (student)',    'e2e-tenant-98',      '{}'::jsonb, 'active'),
  ('00000000-0000-4000-8000-000000000099', 'E2E Tenant 99 (assessment)', 'e2e-tenant-99',      '{}'::jsonb, 'active')
ON CONFLICT (id) DO UPDATE
  SET status = 'active',
      deleted_at = NULL,
      updated_at = now();

-- ---------------------------------------------------------------------------
-- Institution fixture for tenant A (G-722): institution-scoped pages
-- (/institutions/:id/timetable, /gradebook, /schedule) need a real row or the
-- `[id]` layout calls notFound(). The id matches the E2E_INSTITUTION_ID default
-- in the timetable/gradebook inventory specs. geographic_areas is tenant-only
-- RLS, so bind app.tenant_id transaction-locally as well.
-- ---------------------------------------------------------------------------
DO $$ BEGIN PERFORM set_config('app.tenant_id', '00000000-0000-4000-8000-000000000001', true); END $$;

-- ---------------------------------------------------------------------------
-- Cross-domain student parents used by the parent, LMS, fees, and library
-- live journeys. Keep these explicit even though some migration/demo paths
-- create …0099: the E2E harness must remain self-contained and retry-safe.
-- ---------------------------------------------------------------------------
INSERT INTO students (id, tenant_id, first_name, last_name, date_of_birth, gender, custom_data)
VALUES
  ('00000000-0000-4000-8000-000000000099', '00000000-0000-4000-8000-000000000001', 'Parent',  'Portal', DATE '2012-01-01', 'unspecified', '{"e2e":true}'::jsonb),
  ('00000000-0000-4000-8000-0000000000aa', '00000000-0000-4000-8000-000000000001', 'Fees',    'Student', DATE '2012-01-02', 'unspecified', '{"e2e":true}'::jsonb),
  ('00000000-0000-4000-8000-000000000094', '00000000-0000-4000-8000-000000000001', 'Library', 'Hold', DATE '2012-01-03', 'unspecified', '{"e2e":true}'::jsonb),
  ('c4018ef3-2454-4ee0-b904-22add0d1c596', '00000000-0000-4000-8000-000000000001', 'LMS', 'Learner', DATE '2012-01-04', 'unspecified', '{"e2e":true}'::jsonb),
  ('aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaa1', '00000000-0000-4000-8000-000000000001', 'LMS', 'Essay', DATE '2012-01-05', 'unspecified', '{"e2e":true}'::jsonb)
ON CONFLICT (id) DO UPDATE
  SET deleted_at = NULL,
      updated_at = now()
  WHERE students.tenant_id = EXCLUDED.tenant_id;

-- Guardian access is household/custody-scoped and fails closed. Seed stable
-- actors so Playwright retries do not create duplicate links or bypass custody.
INSERT INTO guardian_households (id, tenant_id, label, status)
VALUES (
  '00000000-0000-4000-8000-00000000a101',
  '00000000-0000-4000-8000-000000000001',
  'E2E Guardian Household',
  'active'
)
ON CONFLICT (id) DO UPDATE SET status = 'active', updated_at = now();

INSERT INTO guardian_household_members
  (id, tenant_id, household_id, parent_user_id, role, status)
VALUES
  ('00000000-0000-4000-8000-00000000a111', '00000000-0000-4000-8000-000000000001', '00000000-0000-4000-8000-00000000a101', 'parent-e2e-seeded', 'primary', 'active'),
  ('00000000-0000-4000-8000-00000000a112', '00000000-0000-4000-8000-000000000001', '00000000-0000-4000-8000-00000000a101', 'parent-jwt-seeded', 'guardian', 'active'),
  ('00000000-0000-4000-8000-00000000a113', '00000000-0000-4000-8000-000000000001', '00000000-0000-4000-8000-00000000a101', 'parent-iso-seeded', 'guardian', 'active')
ON CONFLICT (tenant_id, household_id, parent_user_id) DO UPDATE
  SET status = 'active', updated_at = now();

INSERT INTO guardian_student_custody
  (id, tenant_id, student_id, household_id, custody_type, status, effective_from)
VALUES (
  '00000000-0000-4000-8000-00000000a121',
  '00000000-0000-4000-8000-000000000001',
  '00000000-0000-4000-8000-000000000099',
  '00000000-0000-4000-8000-00000000a101',
  'sole',
  'active',
  TIMESTAMPTZ '2026-01-01T00:00:00Z'
)
ON CONFLICT (tenant_id, student_id, household_id) DO UPDATE
  SET custody_type = 'sole', status = 'active', effective_to = NULL, updated_at = now();

INSERT INTO parent_child_links
  (id, tenant_id, parent_user_id, student_id, relationship, status,
   is_primary, can_consent_medical, can_view_fees, household_id)
VALUES
  ('00000000-0000-4000-8000-00000000a131', '00000000-0000-4000-8000-000000000001', 'parent-e2e-seeded', '00000000-0000-4000-8000-000000000099', 'guardian', 'active', true, true, true, '00000000-0000-4000-8000-00000000a101'),
  ('00000000-0000-4000-8000-00000000a132', '00000000-0000-4000-8000-000000000001', 'parent-jwt-seeded', '00000000-0000-4000-8000-000000000099', 'guardian', 'active', true, true, true, '00000000-0000-4000-8000-00000000a101'),
  ('00000000-0000-4000-8000-00000000a133', '00000000-0000-4000-8000-000000000001', 'parent-iso-seeded', '00000000-0000-4000-8000-000000000099', 'guardian', 'active', true, true, true, '00000000-0000-4000-8000-00000000a101')
ON CONFLICT (tenant_id, parent_user_id, student_id) DO UPDATE
  SET status = 'active', household_id = EXCLUDED.household_id,
      can_consent_medical = true, can_view_fees = true, updated_at = now();

INSERT INTO geographic_areas (id, tenant_id, name, code, level, parent_id, path, lft, rgt)
VALUES (
  '00000000-0000-4000-8000-00000000a0ea',
  '00000000-0000-4000-8000-000000000001',
  'E2E District', 'E2E-DIST', 1, NULL, '/E2E-DIST', 1, 2
)
ON CONFLICT (id) DO UPDATE
  SET deleted_at = NULL,
      updated_at = now();

INSERT INTO institutions (id, tenant_id, name, code, area_id, type, sector, ownership, status, custom_data)
VALUES (
  'a2e96cd1-0232-4cce-97e2-00ebbfb9a374',
  '00000000-0000-4000-8000-000000000001',
  'E2E Demo School', 'E2E-SCH-001',
  '00000000-0000-4000-8000-00000000a0ea',
  'school', 'public', 'government', 'active', '{}'::jsonb
)
ON CONFLICT (id) DO UPDATE
  SET status = 'active',
      deleted_at = NULL,
      updated_at = now();

-- ---------------------------------------------------------------------------
-- Academic period + section fixture for tenant A (Wave 9): the gradebook
-- service rejects grade entries whose section does not exist (NotFound), so
-- the gradebook workflow spec (e2e/42) needs a real section. Fixed ids match
-- SECTION_A / PERIOD_A in that spec.
-- ---------------------------------------------------------------------------
INSERT INTO academic_periods (id, tenant_id, name, code, start_date, end_date, status)
VALUES (
  '00000000-0000-4000-8000-00000000ac01',
  '00000000-0000-4000-8000-000000000001',
  'E2E Academic Year', 'E2E-AY',
  DATE '2026-04-01', DATE '2027-03-31', 'active'
)
ON CONFLICT (id) DO UPDATE
  SET status = 'active',
      deleted_at = NULL,
      updated_at = now();

INSERT INTO sections (id, tenant_id, institution_id, academic_period_id, code, name, capacity, status)
VALUES (
  '00000000-0000-4000-8000-00000000eec1',
  '00000000-0000-4000-8000-000000000001',
  'a2e96cd1-0232-4cce-97e2-00ebbfb9a374',
  '00000000-0000-4000-8000-00000000ac01',
  'E2E-SEC-A', 'E2E Section A', 40, 'PUBLISHED'
)
ON CONFLICT (id) DO UPDATE
  SET deleted_at = NULL,
      status = 'PUBLISHED',
      updated_at = now();

COMMIT;
