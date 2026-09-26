-- Sunrise Public School — one-tenant screen-review demo.
-- Idempotent (fixed ids, ON CONFLICT DO NOTHING). Does not delete rows.
-- Does not touch attendance.
--
-- Not applied by tools/scripts/apply-sql.sh. Run after Prisma migrate and
-- domain SQL (so staff_assignments, fee plans, and consent versioning exist):
--
--   psql "$DATABASE_URL" -v ON_ERROR_STOP=1 -f db/seeds/006_sunrise_public_school_demo.sql
--
-- Tenant
--   id:   00000000-0000-4000-8000-00000000a501
--   slug: sunrise-public-school
--   name: Sunrise Public School
--
-- This file does not create a password login. Auth identities live outside
-- these domain tables (Keycloak / control_plane_documents). Bind this tenant
-- id the same way a reviewer already binds the E2E tenant
-- 00000000-0000-4000-8000-000000000001 (session tenantId / X-Tenant-ID).
-- Parent-portal actor ids on the consent rows are parent-mehta and parent-sharma.
--
-- RLS: tenants writes need app.platform_admin; domain tables need app.tenant_id.
-- Both are transaction-local. FORCE RLS still applies to the table owner.

\set ON_ERROR_STOP on

BEGIN;

DO $$ BEGIN
  PERFORM set_config('app.platform_admin', '1', true);
  PERFORM set_app_tenant_id('00000000-0000-4000-8000-00000000a501');
END $$;

INSERT INTO tenants (id, name, slug, config, status)
VALUES (
  '00000000-0000-4000-8000-00000000a501',
  'Sunrise Public School',
  'sunrise-public-school',
  '{"locale":"en-IN","timezone":"Asia/Kolkata","currency":"INR","demo":"sunrise-screen-review"}'::jsonb,
  'active'
)
ON CONFLICT (id) DO NOTHING;

INSERT INTO geographic_areas (id, tenant_id, name, code, level, parent_id, path, lft, rgt)
VALUES (
  '00000000-0000-4000-8000-00000000a511',
  '00000000-0000-4000-8000-00000000a501',
  'Pune',
  'PUNE',
  1,
  NULL,
  'PUNE',
  1,
  2
)
ON CONFLICT (id) DO NOTHING;

INSERT INTO boards (id, tenant_id, name, code, type, status)
VALUES (
  '00000000-0000-4000-8000-00000000a521',
  '00000000-0000-4000-8000-00000000a501',
  'Central Board of Secondary Education',
  'CBSE',
  'NATIONAL',
  'active'
)
ON CONFLICT (id) DO NOTHING;

INSERT INTO academic_periods (
  id, tenant_id, name, code, start_date, end_date, status, valid_from, valid_to, version
)
VALUES (
  '00000000-0000-4000-8000-00000000a531',
  '00000000-0000-4000-8000-00000000a501',
  'AY 2026-27',
  'AY26-27',
  DATE '2026-04-01',
  DATE '2027-03-31',
  'active',
  DATE '2026-04-01',
  DATE '2027-03-31',
  1
)
ON CONFLICT (id) DO NOTHING;

INSERT INTO grades (id, tenant_id, name, code, "order")
VALUES
  ('00000000-0000-4000-8000-00000000a541', '00000000-0000-4000-8000-00000000a501', 'Grade 8', 'G8', 8),
  ('00000000-0000-4000-8000-00000000a542', '00000000-0000-4000-8000-00000000a501', 'Grade 9', 'G9', 9),
  ('00000000-0000-4000-8000-00000000a543', '00000000-0000-4000-8000-00000000a501', 'Grade 10', 'G10', 10)
ON CONFLICT (id) DO NOTHING;

INSERT INTO institutions (
  id, tenant_id, name, code, board_id, area_id, type, sector, ownership, status, custom_data
)
VALUES (
  '00000000-0000-4000-8000-00000000a551',
  '00000000-0000-4000-8000-00000000a501',
  'Sunrise Public School',
  'SPS-PUN-01',
  '00000000-0000-4000-8000-00000000a521',
  '00000000-0000-4000-8000-00000000a511',
  'school',
  'private',
  'private',
  'active',
  '{"city":"Pune","boardCode":"CBSE","currency":"INR","demo":"sunrise-screen-review"}'::jsonb
)
ON CONFLICT (id) DO NOTHING;

INSERT INTO subjects (id, tenant_id, name, code)
VALUES (
  '00000000-0000-4000-8000-00000000a581',
  '00000000-0000-4000-8000-00000000a501',
  'Mathematics',
  'MATH'
)
ON CONFLICT (id) DO NOTHING;

INSERT INTO staff (id, tenant_id, first_name, last_name, date_of_birth, identity_number, custom_data)
VALUES
  (
    '00000000-0000-4000-8000-00000000a591',
    '00000000-0000-4000-8000-00000000a501',
    'Sunil',
    'Rao',
    DATE '1978-03-12',
    'SPS-PRINCIPAL',
    '{"__profile":{"contactPhone":"+91 90000 10001","contactEmail":"sunil.rao@school.edu","position":"Principal","status":"ACTIVE"}}'::jsonb
  ),
  (
    '00000000-0000-4000-8000-00000000a592',
    '00000000-0000-4000-8000-00000000a501',
    'Priya',
    'Sharma',
    DATE '1988-11-02',
    'SPS-CT-9B',
    '{"__profile":{"contactPhone":"+91 90000 10002","contactEmail":"priya.sharma@school.edu","position":"Class teacher","status":"ACTIVE"}}'::jsonb
  ),
  (
    '00000000-0000-4000-8000-00000000a593',
    '00000000-0000-4000-8000-00000000a501',
    'Neha',
    'Verma',
    DATE '1990-07-19',
    'SPS-ACCOUNTS',
    '{"__profile":{"contactPhone":"+91 90000 10003","contactEmail":"neha.verma@school.edu","position":"Accounts","status":"ACTIVE"}}'::jsonb
  )
ON CONFLICT (id) DO NOTHING;

INSERT INTO classes (
  id, tenant_id, institution_id, grade_id, academic_period_id, name, capacity
)
VALUES
  (
    '00000000-0000-4000-8000-00000000a561',
    '00000000-0000-4000-8000-00000000a501',
    '00000000-0000-4000-8000-00000000a551',
    '00000000-0000-4000-8000-00000000a541',
    '00000000-0000-4000-8000-00000000a531',
    '8-A',
    40
  ),
  (
    '00000000-0000-4000-8000-00000000a562',
    '00000000-0000-4000-8000-00000000a501',
    '00000000-0000-4000-8000-00000000a551',
    '00000000-0000-4000-8000-00000000a542',
    '00000000-0000-4000-8000-00000000a531',
    '9-B',
    40
  ),
  (
    '00000000-0000-4000-8000-00000000a563',
    '00000000-0000-4000-8000-00000000a501',
    '00000000-0000-4000-8000-00000000a551',
    '00000000-0000-4000-8000-00000000a543',
    '00000000-0000-4000-8000-00000000a531',
    '10-A',
    40
  )
ON CONFLICT (id) DO NOTHING;

INSERT INTO sections (
  id, tenant_id, institution_id, academic_period_id, grade_id, code, name,
  primary_teacher_id, capacity, status
)
VALUES
  (
    '00000000-0000-4000-8000-00000000a571',
    '00000000-0000-4000-8000-00000000a501',
    '00000000-0000-4000-8000-00000000a551',
    '00000000-0000-4000-8000-00000000a531',
    '00000000-0000-4000-8000-00000000a541',
    '8-A',
    'Class 8-A',
    NULL,
    40,
    'PUBLISHED'
  ),
  (
    '00000000-0000-4000-8000-00000000a572',
    '00000000-0000-4000-8000-00000000a501',
    '00000000-0000-4000-8000-00000000a551',
    '00000000-0000-4000-8000-00000000a531',
    '00000000-0000-4000-8000-00000000a542',
    '9-B',
    'Class 9-B',
    '00000000-0000-4000-8000-00000000a592',
    40,
    'PUBLISHED'
  ),
  (
    '00000000-0000-4000-8000-00000000a573',
    '00000000-0000-4000-8000-00000000a501',
    '00000000-0000-4000-8000-00000000a551',
    '00000000-0000-4000-8000-00000000a531',
    '00000000-0000-4000-8000-00000000a543',
    '10-A',
    'Class 10-A',
    NULL,
    40,
    'PUBLISHED'
  )
ON CONFLICT (id) DO NOTHING;

INSERT INTO staff_assignments (
  id, tenant_id, staff_id, institution_id, subject_id, class_id, role,
  allocation_percentage, start_date, status
)
VALUES
  (
    '00000000-0000-4000-8000-00000000a5a1',
    '00000000-0000-4000-8000-00000000a501',
    '00000000-0000-4000-8000-00000000a591',
    '00000000-0000-4000-8000-00000000a551',
    NULL,
    NULL,
    'principal',
    100,
    DATE '2026-04-01',
    'ACTIVE'
  ),
  (
    '00000000-0000-4000-8000-00000000a5a2',
    '00000000-0000-4000-8000-00000000a501',
    '00000000-0000-4000-8000-00000000a592',
    '00000000-0000-4000-8000-00000000a551',
    '00000000-0000-4000-8000-00000000a581',
    '00000000-0000-4000-8000-00000000a562',
    'class_teacher',
    100,
    DATE '2026-04-01',
    'ACTIVE'
  ),
  (
    '00000000-0000-4000-8000-00000000a5a3',
    '00000000-0000-4000-8000-00000000a501',
    '00000000-0000-4000-8000-00000000a593',
    '00000000-0000-4000-8000-00000000a551',
    NULL,
    NULL,
    'accounts',
    100,
    DATE '2026-04-01',
    'ACTIVE'
  )
ON CONFLICT (id) DO NOTHING;

INSERT INTO students (
  id, tenant_id, first_name, last_name, date_of_birth, gender, national_id,
  admission_number, custom_data
)
VALUES
  (
    '00000000-0000-4000-8000-00000000a5b1',
    '00000000-0000-4000-8000-00000000a501',
    'Aarav', 'Mehta', DATE '2011-04-18', 'male', 'SPS-NID-001', 'SPS/2026/001',
    '{"admissionNo":"SPS/2026/001","__profile":{"nationality":"IN","contacts":[{"type":"phone","value":"+91 90000 20001","isPrimary":true}],"guardians":[],"identityDocuments":[]}}'::jsonb
  ),
  (
    '00000000-0000-4000-8000-00000000a5b2',
    '00000000-0000-4000-8000-00000000a501',
    'Diya', 'Sharma', DATE '2011-08-09', 'female', 'SPS-NID-002', 'SPS/2026/002',
    '{"admissionNo":"SPS/2026/002","__profile":{"nationality":"IN","contacts":[{"type":"phone","value":"+91 90000 20002","isPrimary":true}],"guardians":[],"identityDocuments":[]}}'::jsonb
  ),
  (
    '00000000-0000-4000-8000-00000000a5b3',
    '00000000-0000-4000-8000-00000000a501',
    'Vivaan', 'Patel', DATE '2012-01-22', 'male', 'SPS-NID-003', 'SPS/2026/003',
    '{"admissionNo":"SPS/2026/003","__profile":{"nationality":"IN","contacts":[{"type":"phone","value":"+91 90000 20003","isPrimary":true}],"guardians":[],"identityDocuments":[]}}'::jsonb
  ),
  (
    '00000000-0000-4000-8000-00000000a5b4',
    '00000000-0000-4000-8000-00000000a501',
    'Ananya', 'Reddy', DATE '2010-12-03', 'female', 'SPS-NID-004', 'SPS/2026/004',
    '{"admissionNo":"SPS/2026/004","__profile":{"nationality":"IN","contacts":[{"type":"phone","value":"+91 90000 20004","isPrimary":true}],"guardians":[],"identityDocuments":[]}}'::jsonb
  ),
  (
    '00000000-0000-4000-8000-00000000a5b5',
    '00000000-0000-4000-8000-00000000a501',
    'Rohan', 'Mehta', DATE '2012-06-14', 'male', 'SPS-NID-005', 'SPS/2026/005',
    '{"admissionNo":"SPS/2026/005","__profile":{"nationality":"IN","contacts":[{"type":"phone","value":"+91 90000 20005","isPrimary":true}],"guardians":[],"identityDocuments":[]}}'::jsonb
  )
ON CONFLICT (id) DO NOTHING;

INSERT INTO enrollments (
  id, tenant_id, student_id, institution_id, grade_id, class_id, academic_period_id,
  status, enrolled_at
)
VALUES
  (
    '00000000-0000-4000-8000-00000000a5c1',
    '00000000-0000-4000-8000-00000000a501',
    '00000000-0000-4000-8000-00000000a5b1',
    '00000000-0000-4000-8000-00000000a551',
    '00000000-0000-4000-8000-00000000a542',
    '00000000-0000-4000-8000-00000000a562',
    '00000000-0000-4000-8000-00000000a531',
    'ENROLLED',
    DATE '2026-04-06'
  ),
  (
    '00000000-0000-4000-8000-00000000a5c2',
    '00000000-0000-4000-8000-00000000a501',
    '00000000-0000-4000-8000-00000000a5b2',
    '00000000-0000-4000-8000-00000000a551',
    '00000000-0000-4000-8000-00000000a542',
    '00000000-0000-4000-8000-00000000a562',
    '00000000-0000-4000-8000-00000000a531',
    'ENROLLED',
    DATE '2026-04-06'
  ),
  (
    '00000000-0000-4000-8000-00000000a5c3',
    '00000000-0000-4000-8000-00000000a501',
    '00000000-0000-4000-8000-00000000a5b3',
    '00000000-0000-4000-8000-00000000a551',
    '00000000-0000-4000-8000-00000000a541',
    '00000000-0000-4000-8000-00000000a561',
    '00000000-0000-4000-8000-00000000a531',
    'ENROLLED',
    DATE '2026-04-06'
  ),
  (
    '00000000-0000-4000-8000-00000000a5c4',
    '00000000-0000-4000-8000-00000000a501',
    '00000000-0000-4000-8000-00000000a5b4',
    '00000000-0000-4000-8000-00000000a551',
    '00000000-0000-4000-8000-00000000a543',
    '00000000-0000-4000-8000-00000000a563',
    '00000000-0000-4000-8000-00000000a531',
    'ENROLLED',
    DATE '2026-04-06'
  ),
  (
    '00000000-0000-4000-8000-00000000a5c5',
    '00000000-0000-4000-8000-00000000a501',
    '00000000-0000-4000-8000-00000000a5b5',
    '00000000-0000-4000-8000-00000000a551',
    '00000000-0000-4000-8000-00000000a541',
    '00000000-0000-4000-8000-00000000a561',
    '00000000-0000-4000-8000-00000000a531',
    'ENROLLED',
    DATE '2026-04-06'
  )
ON CONFLICT (id) DO NOTHING;

INSERT INTO section_enrollments (id, tenant_id, section_id, student_id, status, enrolled_at)
VALUES
  ('00000000-0000-4000-8000-00000000a5d1', '00000000-0000-4000-8000-00000000a501', '00000000-0000-4000-8000-00000000a572', '00000000-0000-4000-8000-00000000a5b1', 'ENROLLED', DATE '2026-04-06'),
  ('00000000-0000-4000-8000-00000000a5d2', '00000000-0000-4000-8000-00000000a501', '00000000-0000-4000-8000-00000000a572', '00000000-0000-4000-8000-00000000a5b2', 'ENROLLED', DATE '2026-04-06'),
  ('00000000-0000-4000-8000-00000000a5d3', '00000000-0000-4000-8000-00000000a501', '00000000-0000-4000-8000-00000000a571', '00000000-0000-4000-8000-00000000a5b3', 'ENROLLED', DATE '2026-04-06'),
  ('00000000-0000-4000-8000-00000000a5d4', '00000000-0000-4000-8000-00000000a501', '00000000-0000-4000-8000-00000000a573', '00000000-0000-4000-8000-00000000a5b4', 'ENROLLED', DATE '2026-04-06'),
  ('00000000-0000-4000-8000-00000000a5d5', '00000000-0000-4000-8000-00000000a501', '00000000-0000-4000-8000-00000000a571', '00000000-0000-4000-8000-00000000a5b5', 'ENROLLED', DATE '2026-04-06')
ON CONFLICT (id) DO NOTHING;

INSERT INTO guardian_households (id, tenant_id, label, status)
VALUES
  ('00000000-0000-4000-8000-00000000a631', '00000000-0000-4000-8000-00000000a501', 'Mehta household', 'active'),
  ('00000000-0000-4000-8000-00000000a632', '00000000-0000-4000-8000-00000000a501', 'Sharma household', 'active')
ON CONFLICT (id) DO NOTHING;

INSERT INTO guardian_household_members (id, tenant_id, household_id, parent_user_id, role, status)
VALUES
  ('00000000-0000-4000-8000-00000000a633', '00000000-0000-4000-8000-00000000a501', '00000000-0000-4000-8000-00000000a631', 'parent-mehta', 'primary', 'active'),
  ('00000000-0000-4000-8000-00000000a634', '00000000-0000-4000-8000-00000000a501', '00000000-0000-4000-8000-00000000a632', 'parent-sharma', 'primary', 'active')
ON CONFLICT (id) DO NOTHING;

INSERT INTO guardian_student_custody (
  id, tenant_id, student_id, household_id, custody_type, status, effective_from
)
VALUES
  (
    '00000000-0000-4000-8000-00000000a635',
    '00000000-0000-4000-8000-00000000a501',
    '00000000-0000-4000-8000-00000000a5b1',
    '00000000-0000-4000-8000-00000000a631',
    'sole',
    'active',
    TIMESTAMPTZ '2026-04-01 00:00:00+05:30'
  ),
  (
    '00000000-0000-4000-8000-00000000a636',
    '00000000-0000-4000-8000-00000000a501',
    '00000000-0000-4000-8000-00000000a5b2',
    '00000000-0000-4000-8000-00000000a632',
    'sole',
    'active',
    TIMESTAMPTZ '2026-04-01 00:00:00+05:30'
  )
ON CONFLICT (id) DO NOTHING;

INSERT INTO parent_child_links (
  id, tenant_id, parent_user_id, student_id, relationship, status,
  is_primary, can_consent_medical, can_view_fees, household_id
)
VALUES
  (
    '00000000-0000-4000-8000-00000000a637',
    '00000000-0000-4000-8000-00000000a501',
    'parent-mehta',
    '00000000-0000-4000-8000-00000000a5b1',
    'father',
    'active',
    true,
    true,
    true,
    '00000000-0000-4000-8000-00000000a631'
  ),
  (
    '00000000-0000-4000-8000-00000000a638',
    '00000000-0000-4000-8000-00000000a501',
    'parent-sharma',
    '00000000-0000-4000-8000-00000000a5b2',
    'mother',
    'active',
    true,
    true,
    true,
    '00000000-0000-4000-8000-00000000a632'
  )
ON CONFLICT (id) DO NOTHING;

-- Append-only consents: insert the decided row already decided. Do not UPDATE.
INSERT INTO parent_consents (
  id, tenant_id, student_id, parent_user_id, consent_type, title, description, status,
  consent_version, decided_at, created_by, consent_chain_id, version, supersedes_id, valid_from
)
VALUES
  (
    '00000000-0000-4000-8000-00000000a621',
    '00000000-0000-4000-8000-00000000a501',
    '00000000-0000-4000-8000-00000000a5b1',
    'parent-mehta',
    'photo_media',
    'School photo and media consent',
    'Allow Sunrise Public School to use Aarav Mehta''s image in the yearbook and newsletter.',
    'pending',
    'photo-media-v2026-01',
    NULL,
    'priya.sharma',
    '00000000-0000-4000-8000-00000000a621',
    1,
    NULL,
    TIMESTAMPTZ '2026-08-01 09:00:00+05:30'
  ),
  (
    '00000000-0000-4000-8000-00000000a622',
    '00000000-0000-4000-8000-00000000a501',
    '00000000-0000-4000-8000-00000000a5b2',
    'parent-sharma',
    'field_trip',
    'Grade 9 field trip consent',
    'Consent for Diya Sharma to join the Grade 9 Pune heritage field trip.',
    'approved',
    'field-trip-v2026-01',
    TIMESTAMPTZ '2026-08-20 09:30:00+05:30',
    'priya.sharma',
    '00000000-0000-4000-8000-00000000a622',
    1,
    NULL,
    TIMESTAMPTZ '2026-08-12 09:00:00+05:30'
  )
ON CONFLICT (id) DO NOTHING;

INSERT INTO parent_fee_plans (
  id, tenant_id, code, name, description, amount_cents, currency, frequency, status, created_by
)
VALUES
  (
    '00000000-0000-4000-8000-00000000a5e1',
    '00000000-0000-4000-8000-00000000a501',
    'SPS-TUITION-T1',
    'Term 1 tuition',
    'Sunrise Public School term tuition (INR).',
    4500000,
    'INR',
    'term',
    'active',
    'neha.verma'
  ),
  (
    '00000000-0000-4000-8000-00000000a5e2',
    '00000000-0000-4000-8000-00000000a501',
    'SPS-TRANSPORT-T1',
    'Term 1 transport',
    'Sunrise Public School bus fee (INR).',
    1200000,
    'INR',
    'term',
    'active',
    'neha.verma'
  ),
  (
    '00000000-0000-4000-8000-00000000a5e3',
    '00000000-0000-4000-8000-00000000a501',
    'SPS-EXAM',
    'Board exam fee',
    'CBSE board exam fee (INR).',
    150000,
    'INR',
    'once',
    'active',
    'neha.verma'
  )
ON CONFLICT (id) DO NOTHING;

INSERT INTO fee_structures (
  id, tenant_id, institution_id, academic_period_id, grade_id, class_id,
  category, term, code, name, amount_cents, currency, status, created_by,
  valid_from, valid_to, version
)
VALUES
  (
    '00000000-0000-4000-8000-00000000a5e4',
    '00000000-0000-4000-8000-00000000a501',
    '00000000-0000-4000-8000-00000000a551',
    '00000000-0000-4000-8000-00000000a531',
    '00000000-0000-4000-8000-00000000a542',
    '00000000-0000-4000-8000-00000000a562',
    'tuition',
    'Term 1',
    'SPS-FEE-TUITION-9B',
    'Grade 9-B term tuition',
    4500000,
    'INR',
    'active',
    'neha.verma',
    DATE '2026-04-01',
    DATE '2027-03-31',
    1
  ),
  (
    '00000000-0000-4000-8000-00000000a5e5',
    '00000000-0000-4000-8000-00000000a501',
    '00000000-0000-4000-8000-00000000a551',
    '00000000-0000-4000-8000-00000000a531',
    NULL,
    NULL,
    'transport',
    'Term 1',
    'SPS-FEE-TRANSPORT',
    'School transport',
    1200000,
    'INR',
    'active',
    'neha.verma',
    DATE '2026-04-01',
    DATE '2027-03-31',
    1
  )
ON CONFLICT (id) DO NOTHING;

INSERT INTO fee_structure_components (id, tenant_id, structure_id, name, amount_cents)
VALUES
  (
    '00000000-0000-4000-8000-00000000a5e6',
    '00000000-0000-4000-8000-00000000a501',
    '00000000-0000-4000-8000-00000000a5e4',
    'Tuition',
    4500000
  ),
  (
    '00000000-0000-4000-8000-00000000a5e7',
    '00000000-0000-4000-8000-00000000a501',
    '00000000-0000-4000-8000-00000000a5e5',
    'Transport',
    1200000
  )
ON CONFLICT (id) DO NOTHING;

INSERT INTO parent_fee_invoices (
  id, tenant_id, student_id, title, description, amount_cents, currency, status,
  due_at, created_by, plan_id, invoice_number, structure_id, class_id, grade_id
)
VALUES
  (
    '00000000-0000-4000-8000-00000000a5f1',
    '00000000-0000-4000-8000-00000000a501',
    '00000000-0000-4000-8000-00000000a5b1',
    'Term 1 tuition',
    'Open tuition invoice for Aarav Mehta, class 9-B.',
    4500000,
    'INR',
    'open',
    TIMESTAMPTZ '2026-10-15 00:00:00+05:30',
    'neha.verma',
    '00000000-0000-4000-8000-00000000a5e1',
    'SPS-2026-0001',
    '00000000-0000-4000-8000-00000000a5e4',
    '00000000-0000-4000-8000-00000000a562',
    '00000000-0000-4000-8000-00000000a542'
  ),
  (
    '00000000-0000-4000-8000-00000000a5f2',
    '00000000-0000-4000-8000-00000000a501',
    '00000000-0000-4000-8000-00000000a5b2',
    'Term 1 transport',
    'Paid transport invoice for Diya Sharma.',
    1200000,
    'INR',
    'paid',
    TIMESTAMPTZ '2026-07-15 00:00:00+05:30',
    'neha.verma',
    '00000000-0000-4000-8000-00000000a5e2',
    'SPS-2026-0002',
    '00000000-0000-4000-8000-00000000a5e5',
    '00000000-0000-4000-8000-00000000a562',
    '00000000-0000-4000-8000-00000000a542'
  ),
  (
    '00000000-0000-4000-8000-00000000a5f3',
    '00000000-0000-4000-8000-00000000a501',
    '00000000-0000-4000-8000-00000000a5b4',
    'Board exam fee',
    'Open CBSE exam fee for Ananya Reddy, class 10-A.',
    150000,
    'INR',
    'open',
    TIMESTAMPTZ '2026-11-01 00:00:00+05:30',
    'neha.verma',
    '00000000-0000-4000-8000-00000000a5e3',
    'SPS-2026-0003',
    NULL,
    '00000000-0000-4000-8000-00000000a563',
    '00000000-0000-4000-8000-00000000a543'
  )
ON CONFLICT (id) DO NOTHING;

INSERT INTO parent_fee_payments (
  id, invoice_id, tenant_id, payer_user_id, amount_cents, method, status, paid_at, idempotency_key
)
VALUES (
  '00000000-0000-4000-8000-00000000a5f4',
  '00000000-0000-4000-8000-00000000a5f2',
  '00000000-0000-4000-8000-00000000a501',
  'parent-sharma',
  1200000,
  'upi',
  'succeeded',
  TIMESTAMPTZ '2026-07-10 11:15:00+05:30',
  'sunrise-demo-transport-diya'
)
ON CONFLICT (id) DO NOTHING;

INSERT INTO parent_fee_receipts (
  id, tenant_id, payment_id, invoice_id, receipt_number, amount_cents, currency, issued_at
)
VALUES (
  '00000000-0000-4000-8000-00000000a5f5',
  '00000000-0000-4000-8000-00000000a501',
  '00000000-0000-4000-8000-00000000a5f4',
  '00000000-0000-4000-8000-00000000a5f2',
  'SPS-RCT-2026-0001',
  1200000,
  'INR',
  TIMESTAMPTZ '2026-07-10 11:15:00+05:30'
)
ON CONFLICT (id) DO NOTHING;

-- Balanced journals (deferred check at COMMIT). Append-only: conflict does nothing.
INSERT INTO fee_ledger_entries (
  id, tenant_id, journal_id, invoice_id, payment_id, account, side, amount_cents, currency, memo, posted_by, posted_at
)
VALUES
  ('00000000-0000-4000-8000-00000000a611', '00000000-0000-4000-8000-00000000a501', '00000000-0000-4000-8000-00000000a601', '00000000-0000-4000-8000-00000000a5f1', NULL, 'accounts_receivable', 'debit', 4500000, 'INR', 'Issue SPS-2026-0001', 'neha.verma', TIMESTAMPTZ '2026-04-06 10:00:00+05:30'),
  ('00000000-0000-4000-8000-00000000a612', '00000000-0000-4000-8000-00000000a501', '00000000-0000-4000-8000-00000000a601', '00000000-0000-4000-8000-00000000a5f1', NULL, 'fee_revenue', 'credit', 4500000, 'INR', 'Issue SPS-2026-0001', 'neha.verma', TIMESTAMPTZ '2026-04-06 10:00:00+05:30'),
  ('00000000-0000-4000-8000-00000000a613', '00000000-0000-4000-8000-00000000a501', '00000000-0000-4000-8000-00000000a602', '00000000-0000-4000-8000-00000000a5f2', NULL, 'accounts_receivable', 'debit', 1200000, 'INR', 'Issue SPS-2026-0002', 'neha.verma', TIMESTAMPTZ '2026-04-06 10:00:00+05:30'),
  ('00000000-0000-4000-8000-00000000a614', '00000000-0000-4000-8000-00000000a501', '00000000-0000-4000-8000-00000000a602', '00000000-0000-4000-8000-00000000a5f2', NULL, 'fee_revenue', 'credit', 1200000, 'INR', 'Issue SPS-2026-0002', 'neha.verma', TIMESTAMPTZ '2026-04-06 10:00:00+05:30'),
  ('00000000-0000-4000-8000-00000000a615', '00000000-0000-4000-8000-00000000a501', '00000000-0000-4000-8000-00000000a603', '00000000-0000-4000-8000-00000000a5f3', NULL, 'accounts_receivable', 'debit', 150000, 'INR', 'Issue SPS-2026-0003', 'neha.verma', TIMESTAMPTZ '2026-04-06 10:00:00+05:30'),
  ('00000000-0000-4000-8000-00000000a616', '00000000-0000-4000-8000-00000000a501', '00000000-0000-4000-8000-00000000a603', '00000000-0000-4000-8000-00000000a5f3', NULL, 'fee_revenue', 'credit', 150000, 'INR', 'Issue SPS-2026-0003', 'neha.verma', TIMESTAMPTZ '2026-04-06 10:00:00+05:30'),
  ('00000000-0000-4000-8000-00000000a617', '00000000-0000-4000-8000-00000000a501', '00000000-0000-4000-8000-00000000a604', '00000000-0000-4000-8000-00000000a5f2', '00000000-0000-4000-8000-00000000a5f4', 'cash', 'debit', 1200000, 'INR', 'UPI payment SPS-2026-0002', 'neha.verma', TIMESTAMPTZ '2026-07-10 11:15:00+05:30'),
  ('00000000-0000-4000-8000-00000000a618', '00000000-0000-4000-8000-00000000a501', '00000000-0000-4000-8000-00000000a604', '00000000-0000-4000-8000-00000000a5f2', '00000000-0000-4000-8000-00000000a5f4', 'accounts_receivable', 'credit', 1200000, 'INR', 'UPI payment SPS-2026-0002', 'neha.verma', TIMESTAMPTZ '2026-07-10 11:15:00+05:30')
ON CONFLICT (id) DO NOTHING;

DO $$
DECLARE
  tid CONSTANT uuid := '00000000-0000-4000-8000-00000000a501';
  n_institutions int;
  n_classes int;
  n_sections int;
  n_students int;
  n_staff int;
  n_plans int;
  n_invoices int;
  n_open int;
  n_paid int;
  n_consents int;
  n_pending int;
  n_decided int;
BEGIN
  SELECT count(*) INTO n_institutions FROM institutions WHERE tenant_id = tid AND deleted_at IS NULL AND name = 'Sunrise Public School';
  SELECT count(*) INTO n_classes FROM classes WHERE tenant_id = tid AND deleted_at IS NULL;
  SELECT count(*) INTO n_sections FROM sections WHERE tenant_id = tid AND deleted_at IS NULL;
  SELECT count(*) INTO n_students FROM students WHERE tenant_id = tid AND deleted_at IS NULL;
  SELECT count(*) INTO n_staff FROM staff WHERE tenant_id = tid AND deleted_at IS NULL;
  SELECT count(*) INTO n_plans FROM parent_fee_plans WHERE tenant_id = tid;
  SELECT count(*) INTO n_invoices FROM parent_fee_invoices WHERE tenant_id = tid;
  SELECT count(*) INTO n_open FROM parent_fee_invoices WHERE tenant_id = tid AND status = 'open';
  SELECT count(*) INTO n_paid FROM parent_fee_invoices WHERE tenant_id = tid AND status = 'paid';
  SELECT count(*) INTO n_consents FROM parent_consents WHERE tenant_id = tid;
  SELECT count(*) INTO n_pending FROM parent_consents WHERE tenant_id = tid AND status = 'pending';
  SELECT count(*) INTO n_decided FROM parent_consents WHERE tenant_id = tid AND status IN ('approved', 'denied', 'revoked');

  IF n_institutions < 1 OR n_classes < 3 OR n_sections < 3 OR n_students < 5
     OR n_staff < 3 OR n_plans < 3 OR n_invoices < 3 OR n_open < 1 OR n_paid < 1
     OR n_consents < 2 OR n_pending < 1 OR n_decided < 1 THEN
    RAISE EXCEPTION
      'sunrise demo seed incomplete: institutions=% classes=% sections=% students=% staff=% plans=% invoices=% open=% paid=% consents=% pending=% decided=%',
      n_institutions, n_classes, n_sections, n_students, n_staff, n_plans, n_invoices, n_open, n_paid, n_consents, n_pending, n_decided;
  END IF;

  RAISE NOTICE
    'sunrise demo counts tenant=% institutions=% classes=% sections=% students=% staff=% fee_plans=% fee_invoices=% (open=% paid=%) consents=% (pending=% decided=%)',
    tid, n_institutions, n_classes, n_sections, n_students, n_staff, n_plans, n_invoices, n_open, n_paid, n_consents, n_pending, n_decided;
END $$;

COMMIT;
