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
  -- …096 is also an E2E tenant id above. The overlap smoke posts this UUID as
  -- student_id; 073's transport_student_assignments FK rejects a missing student
  -- with a 500. Keep a real student row on tenant A.
  ('00000000-0000-4000-8000-000000000096', '00000000-0000-4000-8000-000000000001', 'Transport', 'Overlap', DATE '2012-01-06', 'unspecified', '{"e2e":true}'::jsonb),
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

-- Cross-board transfer workflow fixtures (tenant A). CBSE school is the existing
-- demo school; ICSE is a second institution. Aarav is submitted, Diya is under review.
INSERT INTO boards (id, tenant_id, name, code, type, status)
VALUES
  ('00000000-0000-4000-8000-00000000b711', '00000000-0000-4000-8000-000000000001', 'Central Board of Secondary Education', 'CBSE', 'NATIONAL', 'active'),
  ('00000000-0000-4000-8000-00000000b712', '00000000-0000-4000-8000-000000000001', 'Council for the Indian School Certificate Examinations', 'ICSE', 'PRIVATE', 'active')
ON CONFLICT (id) DO UPDATE SET status = 'active', deleted_at = NULL, updated_at = now();

UPDATE institutions
   SET board_id = '00000000-0000-4000-8000-00000000b711', updated_at = now()
 WHERE id = 'a2e96cd1-0232-4cce-97e2-00ebbfb9a374'
   AND tenant_id = '00000000-0000-4000-8000-000000000001';

INSERT INTO institutions (id, tenant_id, name, code, board_id, area_id, type, sector, ownership, status)
VALUES (
  '00000000-0000-4000-8000-00000000b721',
  '00000000-0000-4000-8000-000000000001',
  'E2E ICSE Academy',
  'E2E-ICSE-01',
  '00000000-0000-4000-8000-00000000b712',
  '00000000-0000-4000-8000-00000000a0ea',
  'school', 'public', 'government', 'active'
)
ON CONFLICT (id) DO UPDATE SET status = 'active', deleted_at = NULL, board_id = EXCLUDED.board_id, updated_at = now();

INSERT INTO grades (id, tenant_id, name, code, "order")
VALUES (
  '00000000-0000-4000-8000-00000000b731',
  '00000000-0000-4000-8000-000000000001',
  'Grade 9', 'G9', 9
)
ON CONFLICT (id) DO NOTHING;

INSERT INTO classes (id, tenant_id, institution_id, grade_id, academic_period_id, name, capacity)
VALUES
  ('00000000-0000-4000-8000-00000000b741', '00000000-0000-4000-8000-000000000001', 'a2e96cd1-0232-4cce-97e2-00ebbfb9a374', '00000000-0000-4000-8000-00000000b731', '00000000-0000-4000-8000-00000000ac01', '9-A', 40),
  ('00000000-0000-4000-8000-00000000b742', '00000000-0000-4000-8000-000000000001', '00000000-0000-4000-8000-00000000b721', '00000000-0000-4000-8000-00000000b731', '00000000-0000-4000-8000-00000000ac01', '9-A', 40)
ON CONFLICT (id) DO NOTHING;

INSERT INTO students (id, tenant_id, first_name, last_name, date_of_birth, gender, custom_data)
VALUES
  ('00000000-0000-4000-8000-00000000b751', '00000000-0000-4000-8000-000000000001', 'Aarav', 'Transfer', DATE '2011-04-18', 'male', '{"e2e":"transfer"}'::jsonb),
  ('00000000-0000-4000-8000-00000000b752', '00000000-0000-4000-8000-000000000001', 'Diya', 'Transfer', DATE '2011-08-09', 'female', '{"e2e":"transfer"}'::jsonb)
ON CONFLICT (id) DO UPDATE SET deleted_at = NULL, updated_at = now() WHERE students.tenant_id = EXCLUDED.tenant_id;

-- A previous live run may have completed the transfer and opened a second
-- ENROLLED row. Withdraw those before restoring the source enrollment.
UPDATE enrollments
   SET status = 'WITHDRAWN', exited_at = CURRENT_DATE, updated_at = now()
 WHERE tenant_id = '00000000-0000-4000-8000-000000000001'
   AND student_id IN (
     '00000000-0000-4000-8000-00000000b751',
     '00000000-0000-4000-8000-00000000b752'
   )
   AND id NOT IN (
     '00000000-0000-4000-8000-00000000b761',
     '00000000-0000-4000-8000-00000000b762'
   )
   AND status = 'ENROLLED';

INSERT INTO enrollments (
  id, tenant_id, student_id, institution_id, grade_id, class_id, academic_period_id, status, enrolled_at
)
VALUES
  ('00000000-0000-4000-8000-00000000b761', '00000000-0000-4000-8000-000000000001', '00000000-0000-4000-8000-00000000b751', 'a2e96cd1-0232-4cce-97e2-00ebbfb9a374', '00000000-0000-4000-8000-00000000b731', '00000000-0000-4000-8000-00000000b741', '00000000-0000-4000-8000-00000000ac01', 'ENROLLED', DATE '2026-04-06'),
  ('00000000-0000-4000-8000-00000000b762', '00000000-0000-4000-8000-000000000001', '00000000-0000-4000-8000-00000000b752', 'a2e96cd1-0232-4cce-97e2-00ebbfb9a374', '00000000-0000-4000-8000-00000000b731', '00000000-0000-4000-8000-00000000b741', '00000000-0000-4000-8000-00000000ac01', 'ENROLLED', DATE '2026-04-06')
ON CONFLICT (id) DO UPDATE
  SET status = 'ENROLLED', exited_at = NULL, updated_at = now();

INSERT INTO transfer_records (
  id, tenant_id, student_id, source_institution_id, source_enrollment_id,
  destination_institution_id, destination_enrollment_id, destination_grade_id,
  destination_class_id, academic_period_id, transfer_date, reason, workflow_status, requested_by
)
VALUES
  (
    '00000000-0000-4000-8000-00000000b771',
    '00000000-0000-4000-8000-000000000001',
    '00000000-0000-4000-8000-00000000b751',
    'a2e96cd1-0232-4cce-97e2-00ebbfb9a374',
    '00000000-0000-4000-8000-00000000b761',
    '00000000-0000-4000-8000-00000000b721',
    NULL,
    '00000000-0000-4000-8000-00000000b731',
    '00000000-0000-4000-8000-00000000b742',
    '00000000-0000-4000-8000-00000000ac01',
    DATE '2026-09-01',
    'Family relocated from a CBSE school to an ICSE school',
    'SUBMITTED',
    'e2e-user'
  ),
  (
    '00000000-0000-4000-8000-00000000b772',
    '00000000-0000-4000-8000-000000000001',
    '00000000-0000-4000-8000-00000000b752',
    'a2e96cd1-0232-4cce-97e2-00ebbfb9a374',
    '00000000-0000-4000-8000-00000000b762',
    '00000000-0000-4000-8000-00000000b721',
    NULL,
    '00000000-0000-4000-8000-00000000b731',
    '00000000-0000-4000-8000-00000000b742',
    '00000000-0000-4000-8000-00000000ac01',
    DATE '2026-09-02',
    'State board seat not required — reject path fixture',
    'UNDER_REVIEW',
    'e2e-user'
  )
ON CONFLICT (id) DO UPDATE
  SET workflow_status = EXCLUDED.workflow_status,
      destination_enrollment_id = NULL,
      updated_at = now();

INSERT INTO grade_equivalency_rules (
  id, tenant_id, source_board_id, target_board_id, source_grade_code, target_grade_code,
  source_subject, target_subject, source_marks_max, target_marks_max, credit_factor, mapping_status, notes
)
VALUES (
  '00000000-0000-4000-8000-00000000b781',
  '00000000-0000-4000-8000-000000000001',
  '00000000-0000-4000-8000-00000000b711',
  '00000000-0000-4000-8000-00000000b712',
  'G9', 'G9', 'Mathematics', 'Mathematics', 100, 100, 1, 'mapped',
  'CBSE 100-mark scale maps 1:1 onto ICSE'
)
ON CONFLICT (id) DO NOTHING;

COMMIT;
