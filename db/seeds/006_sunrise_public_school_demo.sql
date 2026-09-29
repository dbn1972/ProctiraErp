-- Sunrise Public School — one-tenant screen-review demo.
-- Idempotent (fixed ids, ON CONFLICT DO NOTHING, plus UPDATEs that rename
-- the original Pune school in place). Does not delete rows.
-- Directory volume (five Delhi schools, generated students/staff/attendance)
-- is appended after the named screen-review rows. Attendance is five recent
-- dates including CURRENT_DATE so "Reporting today" is non-zero.
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
  'Delhi East',
  'DL-EAST',
  1,
  NULL,
  'DL-EAST',
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
  'Sunrise Public School – Mayur Vihar',
  '07040100417',
  '00000000-0000-4000-8000-00000000a521',
  '00000000-0000-4000-8000-00000000a511',
  'Senior Secondary',
  'private',
  'private',
  'active',
  '{"city":"Delhi","boardCode":"CBSE","currency":"INR","demo":"sunrise-screen-review","udise":"07040100417","medium":"English","established":"1998","shift":"Morning (07:30–13:30)","headmaster":"Priya Sharma","__profile":{"latitude":28.6072,"longitude":77.2965,"address":"Plot 12, Pocket B, Mayur Vihar Phase 1, Delhi 110091","contactPhone":"+91 11 2271 0417","contactEmail":"office.mv@sunrisepublic.edu.in","deactivationReason":null}}'::jsonb
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

-- Directory profile. Keeps institution …a551 and every named student, class,
-- fee, and consent row above. Renames that school to Mayur Vihar when a
-- database was seeded before this profile (ON CONFLICT DO NOTHING would
-- otherwise leave "Pune" / SPS-PUN-01 in place).
UPDATE geographic_areas
SET name = 'Delhi East',
    code = 'DL-EAST',
    path = 'DL-EAST',
    updated_at = now()
WHERE id = '00000000-0000-4000-8000-00000000a511'
  AND tenant_id = '00000000-0000-4000-8000-00000000a501';

INSERT INTO geographic_areas (id, tenant_id, name, code, level, parent_id, path, lft, rgt)
VALUES
  (
    '00000000-0000-4000-8000-00000000a512',
    '00000000-0000-4000-8000-00000000a501',
    'Delhi North', 'DL-NORTH', 1, NULL, 'DL-NORTH', 3, 4
  ),
  (
    '00000000-0000-4000-8000-00000000a513',
    '00000000-0000-4000-8000-00000000a501',
    'Delhi South', 'DL-SOUTH', 1, NULL, 'DL-SOUTH', 5, 6
  )
ON CONFLICT (id) DO UPDATE
SET name = EXCLUDED.name, code = EXCLUDED.code, path = EXCLUDED.path, updated_at = now();

UPDATE institutions
SET name = 'Sunrise Public School – Mayur Vihar',
    code = '07040100417',
    type = 'Senior Secondary',
    status = 'active',
    area_id = '00000000-0000-4000-8000-00000000a511',
    custom_data = '{"city":"Delhi","boardCode":"CBSE","currency":"INR","demo":"sunrise-screen-review","udise":"07040100417","medium":"English","established":"1998","shift":"Morning (07:30–13:30)","headmaster":"Priya Sharma","__profile":{"latitude":28.6072,"longitude":77.2965,"address":"Plot 12, Pocket B, Mayur Vihar Phase 1, Delhi 110091","contactPhone":"+91 11 2271 0417","contactEmail":"office.mv@sunrisepublic.edu.in","deactivationReason":null}}'::jsonb,
    updated_at = now()
WHERE id = '00000000-0000-4000-8000-00000000a551'
  AND tenant_id = '00000000-0000-4000-8000-00000000a501';

INSERT INTO institutions (
  id, tenant_id, name, code, board_id, area_id, type, sector, ownership, status, custom_data
)
VALUES
  (
    '00000000-0000-4000-8000-00000000a552',
    '00000000-0000-4000-8000-00000000a501',
    'Sunrise Public School – Preet Vihar',
    '07040100522',
    '00000000-0000-4000-8000-00000000a521',
    '00000000-0000-4000-8000-00000000a511',
    'Secondary', 'private', 'private', 'active',
    '{"city":"Delhi","boardCode":"CBSE","udise":"07040100522"}'::jsonb
  ),
  (
    '00000000-0000-4000-8000-00000000a553',
    '00000000-0000-4000-8000-00000000a501',
    'Sunrise Junior Wing – Patparganj',
    '07040100618',
    '00000000-0000-4000-8000-00000000a521',
    '00000000-0000-4000-8000-00000000a511',
    'Primary', 'private', 'private', 'active',
    '{"city":"Delhi","boardCode":"CBSE","udise":"07040100618"}'::jsonb
  ),
  (
    '00000000-0000-4000-8000-00000000a554',
    '00000000-0000-4000-8000-00000000a501',
    'Sunrise Public School – Rohini Sector 9',
    '07040200731',
    '00000000-0000-4000-8000-00000000a521',
    '00000000-0000-4000-8000-00000000a512',
    'Senior Secondary', 'private', 'private', 'active',
    '{"city":"Delhi","boardCode":"CBSE","udise":"07040200731"}'::jsonb
  ),
  (
    '00000000-0000-4000-8000-00000000a555',
    '00000000-0000-4000-8000-00000000a501',
    'Sunrise Pre-Primary – Vasundhara Enclave',
    '07040100844',
    '00000000-0000-4000-8000-00000000a521',
    '00000000-0000-4000-8000-00000000a511',
    'Pre-Primary', 'private', 'private', 'inactive',
    '{"city":"Delhi","boardCode":"CBSE","udise":"07040100844","__profile":{"deactivationReason":"Merged into Sunrise Public School – Mayur Vihar from academic year 2026–27"}}'::jsonb
  )
ON CONFLICT (id) DO UPDATE
SET name = EXCLUDED.name,
    code = EXCLUDED.code,
    area_id = EXCLUDED.area_id,
    type = EXCLUDED.type,
    status = EXCLUDED.status,
    custom_data = EXCLUDED.custom_data,
    updated_at = now();

INSERT INTO classes (
  id, tenant_id, institution_id, grade_id, academic_period_id, name, capacity
)
VALUES
  (
    '00000000-0000-4000-8000-00000000a564',
    '00000000-0000-4000-8000-00000000a501',
    '00000000-0000-4000-8000-00000000a552',
    '00000000-0000-4000-8000-00000000a541',
    '00000000-0000-4000-8000-00000000a531',
    '8-A', 40
  ),
  (
    '00000000-0000-4000-8000-00000000a565',
    '00000000-0000-4000-8000-00000000a501',
    '00000000-0000-4000-8000-00000000a553',
    '00000000-0000-4000-8000-00000000a541',
    '00000000-0000-4000-8000-00000000a531',
    '5-A', 40
  ),
  (
    '00000000-0000-4000-8000-00000000a566',
    '00000000-0000-4000-8000-00000000a501',
    '00000000-0000-4000-8000-00000000a554',
    '00000000-0000-4000-8000-00000000a541',
    '00000000-0000-4000-8000-00000000a531',
    '8-A', 40
  )
ON CONFLICT (id) DO NOTHING;

-- Generated people. Mayur Vihar already has 5 enrolled students and 3 staff,
-- so this adds 1,235 students and 81 staff there. Other active schools are
-- generated in full. Vasundhara Enclave stays empty and inactive.
INSERT INTO students (
  id, tenant_id, first_name, last_name, date_of_birth, gender, national_id, admission_number
)
SELECT
  uuid_generate_v5(
    '6ba7b810-9dad-11d1-80b4-00c04fd430c8'::uuid,
    'sunrise-stu-' || spec.slug || '-' || gs.n::text
  ),
  '00000000-0000-4000-8000-00000000a501'::uuid,
  (ARRAY[
    'Aarav','Vivaan','Aditya','Arjun','Rohan','Kabir','Ishaan','Vihaan','Reyansh','Sai',
    'Anaya','Diya','Ananya','Aadhya','Myra','Kiara','Navya','Anika','Meera','Saanvi',
    'Kavya','Isha','Riya','Pooja','Lakshmi','Divya','Aanya','Sara','Zara','Inaaya'
  ])[1 + ((gs.n + spec.salt) % 30)],
  (ARRAY[
    'Sharma','Verma','Gupta','Singh','Patel','Reddy','Iyer','Nair','Mehta','Joshi',
    'Kapoor','Malhotra','Banerjee','Chatterjee','Das','Rao','Pillai','Menon','Kulkarni','Deshmukh',
    'Bhat','Chowdhury','Agarwal','Jain','Khan','Yadav','Mishra','Pandey','Tiwari','Sheikh'
  ])[1 + ((gs.n / 7 + spec.salt) % 30)],
  DATE '2011-04-01' + ((gs.n + spec.salt) % 1600),
  CASE WHEN (gs.n + spec.salt) % 2 = 0 THEN 'female' ELSE 'male' END,
  'SPS-NID-' || spec.slug || '-' || lpad(gs.n::text, 5, '0'),
  'SPS/' || spec.slug || '/' || lpad(gs.n::text, 5, '0')
FROM (
  VALUES
    ('MAYUR', 1235, 3),
    ('PREET', 860, 11),
    ('PATPAR', 410, 17),
    ('ROHINI', 1105, 23)
) AS spec(slug, n_students, salt)
CROSS JOIN LATERAL generate_series(1, spec.n_students) AS gs(n)
ON CONFLICT (id) DO NOTHING;

INSERT INTO enrollments (
  id, tenant_id, student_id, institution_id, grade_id, class_id, academic_period_id,
  status, enrolled_at
)
SELECT
  uuid_generate_v5(
    '6ba7b810-9dad-11d1-80b4-00c04fd430c8'::uuid,
    'sunrise-enr-' || spec.slug || '-' || gs.n::text
  ),
  '00000000-0000-4000-8000-00000000a501'::uuid,
  uuid_generate_v5(
    '6ba7b810-9dad-11d1-80b4-00c04fd430c8'::uuid,
    'sunrise-stu-' || spec.slug || '-' || gs.n::text
  ),
  spec.institution_id,
  '00000000-0000-4000-8000-00000000a541'::uuid,
  spec.class_id,
  '00000000-0000-4000-8000-00000000a531'::uuid,
  'ENROLLED',
  DATE '2026-04-06'
FROM (
  VALUES
    ('MAYUR', 1235, '00000000-0000-4000-8000-00000000a551'::uuid, '00000000-0000-4000-8000-00000000a561'::uuid),
    ('PREET', 860, '00000000-0000-4000-8000-00000000a552'::uuid, '00000000-0000-4000-8000-00000000a564'::uuid),
    ('PATPAR', 410, '00000000-0000-4000-8000-00000000a553'::uuid, '00000000-0000-4000-8000-00000000a565'::uuid),
    ('ROHINI', 1105, '00000000-0000-4000-8000-00000000a554'::uuid, '00000000-0000-4000-8000-00000000a566'::uuid)
) AS spec(slug, n_students, institution_id, class_id)
CROSS JOIN LATERAL generate_series(1, spec.n_students) AS gs(n)
ON CONFLICT (id) DO NOTHING;

INSERT INTO staff (
  id, tenant_id, first_name, last_name, date_of_birth, identity_number
)
SELECT
  uuid_generate_v5(
    '6ba7b810-9dad-11d1-80b4-00c04fd430c8'::uuid,
    'sunrise-stf-' || spec.slug || '-' || gs.n::text
  ),
  '00000000-0000-4000-8000-00000000a501'::uuid,
  (ARRAY[
    'Sunil','Amit','Rahul','Vikram','Nikhil','Karan','Manish','Deepak','Suresh','Anil',
    'Priya','Neha','Kavita','Pooja','Anjali','Shreya','Nisha','Ritu','Sneha','Meera'
  ])[1 + ((gs.n + spec.salt) % 20)],
  (ARRAY[
    'Sharma','Verma','Gupta','Singh','Patel','Reddy','Iyer','Nair','Joshi','Rao',
    'Kapoor','Menon','Pillai','Banerjee','Das','Khan','Yadav','Mishra','Bose','Chopra'
  ])[1 + ((gs.n / 5 + spec.salt) % 20)],
  DATE '1976-02-01' + ((gs.n * 17 + spec.salt) % 8000),
  'SPS-STF-' || spec.slug || '-' || lpad(gs.n::text, 5, '0')
FROM (
  VALUES
    ('MAYUR', 81, 2),
    ('PREET', 58, 5),
    ('PATPAR', 27, 8),
    ('ROHINI', 76, 13)
) AS spec(slug, n_staff, salt)
CROSS JOIN LATERAL generate_series(1, spec.n_staff) AS gs(n)
ON CONFLICT (id) DO NOTHING;

INSERT INTO staff_assignments (
  id, tenant_id, staff_id, institution_id, subject_id, class_id, role,
  allocation_percentage, start_date, status
)
SELECT
  uuid_generate_v5(
    '6ba7b810-9dad-11d1-80b4-00c04fd430c8'::uuid,
    'sunrise-asg-' || spec.slug || '-' || gs.n::text
  ),
  '00000000-0000-4000-8000-00000000a501'::uuid,
  uuid_generate_v5(
    '6ba7b810-9dad-11d1-80b4-00c04fd430c8'::uuid,
    'sunrise-stf-' || spec.slug || '-' || gs.n::text
  ),
  spec.institution_id,
  NULL,
  spec.class_id,
  'teacher',
  100,
  DATE '2026-04-01',
  'ACTIVE'
FROM (
  VALUES
    ('MAYUR', 81, '00000000-0000-4000-8000-00000000a551'::uuid, '00000000-0000-4000-8000-00000000a561'::uuid),
    ('PREET', 58, '00000000-0000-4000-8000-00000000a552'::uuid, '00000000-0000-4000-8000-00000000a564'::uuid),
    ('PATPAR', 27, '00000000-0000-4000-8000-00000000a553'::uuid, '00000000-0000-4000-8000-00000000a565'::uuid),
    ('ROHINI', 76, '00000000-0000-4000-8000-00000000a554'::uuid, '00000000-0000-4000-8000-00000000a566'::uuid)
) AS spec(slug, n_staff, institution_id, class_id)
CROSS JOIN LATERAL generate_series(1, spec.n_staff) AS gs(n)
ON CONFLICT (id) DO NOTHING;

-- Five school days ending today. Present-count targets round to 94 / 91 / 88 / 76.
INSERT INTO student_attendance (
  id, tenant_id, student_id, institution_id, class_id, academic_period_id,
  date, status, recorded_by
)
SELECT
  uuid_generate_v5(
    '6ba7b810-9dad-11d1-80b4-00c04fd430c8'::uuid,
    'sunrise-att-' || e.student_id::text || '-' || d.day::text
  ),
  e.tenant_id,
  e.student_id,
  e.institution_id,
  e.class_id,
  e.academic_period_id,
  d.day,
  CASE
    WHEN row_number() OVER (PARTITION BY e.institution_id, d.day ORDER BY e.student_id)
         <= t.present_target
    THEN 'PRESENT'
    ELSE 'ABSENT'
  END,
  '00000000-0000-4000-8000-00000000a591'::uuid
FROM enrollments e
JOIN (
  VALUES
    ('00000000-0000-4000-8000-00000000a551'::uuid, 1166),
    ('00000000-0000-4000-8000-00000000a552'::uuid, 783),
    ('00000000-0000-4000-8000-00000000a553'::uuid, 361),
    ('00000000-0000-4000-8000-00000000a554'::uuid, 840)
) AS t(institution_id, present_target)
  ON t.institution_id = e.institution_id
CROSS JOIN LATERAL (
  SELECT (CURRENT_DATE - offs)::date AS day
  FROM generate_series(0, 4) AS offs
) AS d
WHERE e.tenant_id = '00000000-0000-4000-8000-00000000a501'
  AND e.status = 'ENROLLED'
  AND e.class_id IS NOT NULL
ON CONFLICT (id) DO NOTHING;

-- Class teacher and room on the three Mayur Vihar homerooms (requires 103).
UPDATE classes
SET class_teacher_staff_id = '00000000-0000-4000-8000-00000000a593',
    room_name = 'Room 201',
    updated_at = now()
WHERE id = '00000000-0000-4000-8000-00000000a561'
  AND tenant_id = '00000000-0000-4000-8000-00000000a501';
UPDATE classes
SET class_teacher_staff_id = '00000000-0000-4000-8000-00000000a592',
    room_name = 'Room 202',
    updated_at = now()
WHERE id = '00000000-0000-4000-8000-00000000a562'
  AND tenant_id = '00000000-0000-4000-8000-00000000a501';
UPDATE classes
SET room_name = NULL,
    class_teacher_staff_id = NULL,
    updated_at = now()
WHERE id = '00000000-0000-4000-8000-00000000a563'
  AND tenant_id = '00000000-0000-4000-8000-00000000a501';

-- Bell, meetings, and a teacher clash so the master schedule is not an empty shell.
INSERT INTO bell_schedules (
  id, tenant_id, institution_id, academic_period_id, code, name, status
)
VALUES (
  uuid_generate_v5('6ba7b810-9dad-11d1-80b4-00c04fd430c8'::uuid, 'sunrise-bell-mv'),
  '00000000-0000-4000-8000-00000000a501',
  '00000000-0000-4000-8000-00000000a551',
  '00000000-0000-4000-8000-00000000a531',
  'MORNING',
  'Morning bell',
  'active'
)
ON CONFLICT (tenant_id, institution_id, academic_period_id, code) DO NOTHING;

INSERT INTO bell_periods (
  id, tenant_id, bell_schedule_id, code, name, period_order, start_time, end_time
)
SELECT
  uuid_generate_v5('6ba7b810-9dad-11d1-80b4-00c04fd430c8'::uuid, 'sunrise-period-mv-' || n::text),
  '00000000-0000-4000-8000-00000000a501',
  uuid_generate_v5('6ba7b810-9dad-11d1-80b4-00c04fd430c8'::uuid, 'sunrise-bell-mv'),
  'P' || n::text,
  'Period ' || n::text,
  n,
  TIME '07:40' + ((n - 1) * INTERVAL '50 minutes'),
  TIME '08:20' + ((n - 1) * INTERVAL '50 minutes')
FROM generate_series(1, 6) AS n
ON CONFLICT (bell_schedule_id, code) DO NOTHING;

INSERT INTO sections (
  id, tenant_id, institution_id, academic_period_id, grade_id, code, name,
  primary_teacher_id, default_room_id, capacity, status
)
VALUES (
  uuid_generate_v5('6ba7b810-9dad-11d1-80b4-00c04fd430c8'::uuid, 'sunrise-section-g9b-sci'),
  '00000000-0000-4000-8000-00000000a501',
  '00000000-0000-4000-8000-00000000a551',
  '00000000-0000-4000-8000-00000000a531',
  '00000000-0000-4000-8000-00000000a542',
  'G9B-SCI',
  'Class 9-B Science',
  '00000000-0000-4000-8000-00000000a592',
  NULL,
  40,
  'DRAFT'
)
ON CONFLICT (id) DO NOTHING;

UPDATE sections
SET primary_teacher_id = '00000000-0000-4000-8000-00000000a592'
WHERE id = '00000000-0000-4000-8000-00000000a572';

INSERT INTO section_meetings (
  id, tenant_id, section_id, bell_period_id, day_of_week, room_id, teacher_staff_id, status
)
SELECT
  uuid_generate_v5('6ba7b810-9dad-11d1-80b4-00c04fd430c8'::uuid, 'sunrise-mtg-' || spec.section_key || '-' || spec.day::text),
  '00000000-0000-4000-8000-00000000a501',
  spec.section_id,
  uuid_generate_v5('6ba7b810-9dad-11d1-80b4-00c04fd430c8'::uuid, 'sunrise-period-mv-3'),
  spec.day,
  NULL,
  '00000000-0000-4000-8000-00000000a592',
  'active'
FROM (
  VALUES
    ('9b'::text, '00000000-0000-4000-8000-00000000a572'::uuid, 1),
    ('9b', '00000000-0000-4000-8000-00000000a572'::uuid, 2),
    ('9b', '00000000-0000-4000-8000-00000000a572'::uuid, 3),
    ('8a', '00000000-0000-4000-8000-00000000a571'::uuid, 1)
) AS spec(section_key, section_id, day)
ON CONFLICT (section_id, bell_period_id, day_of_week) DO NOTHING;

INSERT INTO section_enrollments (id, tenant_id, section_id, student_id, status, enrolled_at)
VALUES
  (
    uuid_generate_v5('6ba7b810-9dad-11d1-80b4-00c04fd430c8'::uuid, 'sunrise-enr-aarav'),
    '00000000-0000-4000-8000-00000000a501',
    '00000000-0000-4000-8000-00000000a572',
    '00000000-0000-4000-8000-00000000a5b1',
    'ENROLLED',
    DATE '2026-04-06'
  ),
  (
    uuid_generate_v5('6ba7b810-9dad-11d1-80b4-00c04fd430c8'::uuid, 'sunrise-enr-diya'),
    '00000000-0000-4000-8000-00000000a501',
    '00000000-0000-4000-8000-00000000a572',
    '00000000-0000-4000-8000-00000000a5b2',
    'ENROLLED',
    DATE '2026-04-06'
  )
ON CONFLICT (section_id, student_id) DO NOTHING;

-- Classrooms and recent activity for the Mayur Vihar overview. Deterministic
-- ids so re-running the seed does not duplicate rows.
INSERT INTO rooms (
  id, tenant_id, institution_id, code, name, capacity, room_type, status
)
SELECT
  uuid_generate_v5(
    '6ba7b810-9dad-11d1-80b4-00c04fd430c8'::uuid,
    'sunrise-room-mv-' || gs.n::text
  ),
  '00000000-0000-4000-8000-00000000a501'::uuid,
  '00000000-0000-4000-8000-00000000a551'::uuid,
  'RMV-' || lpad(gs.n::text, 2, '0'),
  'Classroom ' || gs.n::text,
  40,
  'CLASSROOM',
  'active'
FROM generate_series(1, 46) AS gs(n)
ON CONFLICT (id) DO NOTHING;

UPDATE sections
SET default_room_id = uuid_generate_v5('6ba7b810-9dad-11d1-80b4-00c04fd430c8'::uuid, 'sunrise-room-mv-1')
WHERE id = '00000000-0000-4000-8000-00000000a572'
  AND tenant_id = '00000000-0000-4000-8000-00000000a501';

UPDATE section_meetings
SET room_id = uuid_generate_v5('6ba7b810-9dad-11d1-80b4-00c04fd430c8'::uuid, 'sunrise-room-mv-2')
WHERE tenant_id = '00000000-0000-4000-8000-00000000a501'
  AND teacher_staff_id = '00000000-0000-4000-8000-00000000a592'
  AND room_id IS NULL;

-- Mayur Vihar catalogue, homerooms, and master schedule shaped like the
-- approved prototype. Idempotent: fixed ids, ON CONFLICT, and UPDATEs.

UPDATE grades
SET name = 'Class 8', code = '8', "order" = 8, updated_at = now()
WHERE id = '00000000-0000-4000-8000-00000000a541';
UPDATE grades
SET name = 'Class 9', code = '9', "order" = 9, updated_at = now()
WHERE id = '00000000-0000-4000-8000-00000000a542';
UPDATE grades
SET name = 'Class 10', code = '10', "order" = 10, updated_at = now()
WHERE id = '00000000-0000-4000-8000-00000000a543';

INSERT INTO grades (id, tenant_id, name, code, "order")
SELECT
  uuid_generate_v5('6ba7b810-9dad-11d1-80b4-00c04fd430c8'::uuid, 'sunrise-grade-' || spec.code),
  '00000000-0000-4000-8000-00000000a501',
  spec.name,
  spec.code,
  spec.ord
FROM (
  VALUES
    ('LKG', 'Lower KG', 0),
    ('1', 'Class 1', 1),
    ('2', 'Class 2', 2),
    ('3', 'Class 3', 3),
    ('4', 'Class 4', 4),
    ('5', 'Class 5', 5),
    ('6', 'Class 6', 6),
    ('7', 'Class 7', 7),
    ('11', 'Class 11', 11),
    ('12', 'Class 12', 12)
) AS spec(code, name, ord)
ON CONFLICT (id) DO UPDATE
SET name = EXCLUDED.name, code = EXCLUDED.code, "order" = EXCLUDED."order", updated_at = now();

INSERT INTO staff (id, tenant_id, first_name, last_name, date_of_birth, identity_number, custom_data)
VALUES
  ('00000000-0000-4000-8000-00000000a594', '00000000-0000-4000-8000-00000000a501', 'Arun', 'Kapoor', DATE '1984-02-11', 'SPS-CT-9C', '{"__profile":{"position":"Class teacher","status":"ACTIVE"}}'::jsonb),
  ('00000000-0000-4000-8000-00000000a595', '00000000-0000-4000-8000-00000000a501', 'Meera', 'Iyer', DATE '1986-05-21', 'SPS-CT-10A', '{"__profile":{"position":"Class teacher","status":"ACTIVE"}}'::jsonb),
  ('00000000-0000-4000-8000-00000000a596', '00000000-0000-4000-8000-00000000a501', 'Rahul', 'Joshi', DATE '1983-09-09', 'SPS-CT-10B', '{"__profile":{"position":"Class teacher","status":"ACTIVE"}}'::jsonb),
  ('00000000-0000-4000-8000-00000000a597', '00000000-0000-4000-8000-00000000a501', 'Kavita', 'Nair', DATE '1987-01-30', 'SPS-CT-11A', '{"__profile":{"position":"Class teacher","status":"ACTIVE"}}'::jsonb)
ON CONFLICT (id) DO UPDATE
SET first_name = EXCLUDED.first_name, last_name = EXCLUDED.last_name, updated_at = now();

-- Named homerooms keep their original ids so existing attendance rows still join.
UPDATE classes
SET grade_id = '00000000-0000-4000-8000-00000000a542',
    name = 'A',
    capacity = 40,
    class_teacher_staff_id = '00000000-0000-4000-8000-00000000a593',
    room_name = 'Room 201',
    updated_at = now()
WHERE id = '00000000-0000-4000-8000-00000000a561';
UPDATE classes
SET grade_id = '00000000-0000-4000-8000-00000000a542',
    name = 'B',
    capacity = 40,
    class_teacher_staff_id = '00000000-0000-4000-8000-00000000a593',
    room_name = 'Room 202',
    updated_at = now()
WHERE id = '00000000-0000-4000-8000-00000000a562';
UPDATE classes
SET grade_id = '00000000-0000-4000-8000-00000000a543',
    name = 'A',
    capacity = 42,
    class_teacher_staff_id = '00000000-0000-4000-8000-00000000a595',
    room_name = 'Room 301',
    updated_at = now()
WHERE id = '00000000-0000-4000-8000-00000000a563';

INSERT INTO classes (
  id, tenant_id, institution_id, grade_id, academic_period_id, name, capacity,
  class_teacher_staff_id, room_name
)
SELECT
  uuid_generate_v5('6ba7b810-9dad-11d1-80b4-00c04fd430c8'::uuid, 'sunrise-class-mv-' || spec.code || '-' || spec.letter),
  '00000000-0000-4000-8000-00000000a501',
  '00000000-0000-4000-8000-00000000a551',
  g.id,
  '00000000-0000-4000-8000-00000000a531',
  spec.letter,
  spec.capacity,
  spec.teacher,
  spec.room
FROM (
  VALUES
    ('LKG', 'A', 40, NULL::uuid, NULL::text),
    ('LKG', 'B', 40, NULL, NULL),
    ('1', 'A', 40, NULL, NULL),
    ('1', 'B', 40, NULL, NULL),
    ('1', 'C', 40, NULL, NULL),
    ('2', 'A', 40, NULL, NULL),
    ('2', 'B', 40, NULL, NULL),
    ('2', 'C', 40, NULL, NULL),
    ('3', 'A', 40, NULL, NULL),
    ('3', 'B', 40, NULL, NULL),
    ('3', 'C', 40, NULL, NULL),
    ('4', 'A', 40, NULL, NULL),
    ('4', 'B', 40, NULL, NULL),
    ('4', 'C', 40, NULL, NULL),
    ('5', 'A', 40, NULL, NULL),
    ('5', 'B', 40, NULL, NULL),
    ('5', 'C', 40, NULL, NULL),
    ('6', 'A', 40, NULL, NULL),
    ('6', 'B', 40, NULL, NULL),
    ('6', 'C', 40, NULL, NULL),
    ('7', 'A', 40, NULL, NULL),
    ('7', 'B', 40, NULL, NULL),
    ('7', 'C', 40, NULL, NULL),
    ('8', 'A', 40, NULL, NULL),
    ('8', 'B', 40, NULL, NULL),
    ('8', 'C', 40, NULL, NULL),
    ('9', 'C', 40, '00000000-0000-4000-8000-00000000a594'::uuid, 'Room 203'),
    ('9', 'D', 40, NULL, NULL),
    ('10', 'B', 42, '00000000-0000-4000-8000-00000000a596'::uuid, 'Room 302'),
    ('10', 'C', 40, NULL, NULL),
    ('11', 'A (Science)', 36, '00000000-0000-4000-8000-00000000a597'::uuid, 'Lab block L1'),
    ('11', 'B', 48, NULL, NULL),
    ('12', 'A (Commerce)', 34, '00000000-0000-4000-8000-00000000a591'::uuid, 'Room 401'),
    ('12', 'B', 40, NULL, NULL)
) AS spec(code, letter, capacity, teacher, room)
JOIN grades g
  ON g.tenant_id = '00000000-0000-4000-8000-00000000a501'
 AND g.code = spec.code
ON CONFLICT (id) DO UPDATE
SET grade_id = EXCLUDED.grade_id,
    name = EXCLUDED.name,
    capacity = EXCLUDED.capacity,
    class_teacher_staff_id = EXCLUDED.class_teacher_staff_id,
    room_name = EXCLUDED.room_name,
    updated_at = now();

-- Neha Verma's profile used the department "Accounts" as position, which the
-- schedule rendered as "Accounts · Neha Verma".
UPDATE staff
SET custom_data = jsonb_set(custom_data, '{__profile,position}', '"Class teacher"', true),
    updated_at = now()
WHERE id = '00000000-0000-4000-8000-00000000a593'
  AND tenant_id = '00000000-0000-4000-8000-00000000a501';

-- Every Mayur homeroom except 9-D gets a class teacher and a room.
-- Teachers are existing active assignments (staff KPI stays a distinct count).
-- 9-D stays unassigned on purpose.
WITH open_sections AS (
  SELECT c.id,
         row_number() OVER (ORDER BY g."order", c.name, c.id) AS n
  FROM classes c
  JOIN grades g ON g.id = c.grade_id
  WHERE c.institution_id = '00000000-0000-4000-8000-00000000a551'
    AND c.deleted_at IS NULL
    AND c.class_teacher_staff_id IS NULL
    AND NOT (g.code = '9' AND c.name = 'D')
),
teacher_pool AS (
  SELECT s.id,
         row_number() OVER (ORDER BY s.last_name, s.first_name, s.id) AS n
  FROM staff s
  JOIN staff_assignments sa
    ON sa.staff_id = s.id
   AND sa.institution_id = '00000000-0000-4000-8000-00000000a551'
   AND sa.status = 'ACTIVE'
  WHERE s.tenant_id = '00000000-0000-4000-8000-00000000a501'
    AND NOT EXISTS (
      SELECT 1 FROM classes taken
      WHERE taken.institution_id = '00000000-0000-4000-8000-00000000a551'
        AND taken.deleted_at IS NULL
        AND taken.class_teacher_staff_id = s.id
    )
)
UPDATE classes c
SET class_teacher_staff_id = teacher_pool.id,
    updated_at = now()
FROM open_sections
JOIN teacher_pool USING (n)
WHERE c.id = open_sections.id;

WITH open_rooms AS (
  SELECT c.id,
         row_number() OVER (ORDER BY g."order", c.name, c.id) AS n
  FROM classes c
  JOIN grades g ON g.id = c.grade_id
  WHERE c.institution_id = '00000000-0000-4000-8000-00000000a551'
    AND c.deleted_at IS NULL
    AND (c.room_name IS NULL OR btrim(c.room_name) = '')
    AND NOT (g.code = '9' AND c.name = 'D')
),
room_pool AS (
  SELECT r.name,
         row_number() OVER (ORDER BY r.code, r.id) AS n
  FROM rooms r
  WHERE r.institution_id = '00000000-0000-4000-8000-00000000a551'
    AND r.deleted_at IS NULL
    AND NOT EXISTS (
      SELECT 1 FROM classes taken
      WHERE taken.institution_id = r.institution_id
        AND taken.deleted_at IS NULL
        AND taken.room_name = r.name
    )
)
UPDATE classes c
SET room_name = room_pool.name,
    updated_at = now()
FROM open_rooms
JOIN room_pool USING (n)
WHERE c.id = open_rooms.id;

WITH mayur AS (
  SELECT id, row_number() OVER (ORDER BY student_id) AS n
  FROM enrollments
  WHERE tenant_id = '00000000-0000-4000-8000-00000000a501'
    AND institution_id = '00000000-0000-4000-8000-00000000a551'
    AND status = 'ENROLLED'
),
bands AS (
  SELECT
    spec.code,
    spec.n_students,
    spec.n_sections,
    SUM(spec.n_students) OVER (ORDER BY spec.ord) AS hi,
    SUM(spec.n_students) OVER (ORDER BY spec.ord) - spec.n_students AS lo
  FROM (
    VALUES
      ('1', 96, 3, 1),
      ('2', 102, 3, 2),
      ('3', 98, 3, 3),
      ('4', 104, 3, 4),
      ('5', 110, 3, 5),
      ('6', 118, 3, 6),
      ('7', 112, 3, 7),
      ('8', 108, 3, 8),
      ('9', 124, 4, 9),
      ('10', 116, 3, 10),
      ('11', 82, 2, 11),
      ('12', 70, 2, 12)
  ) AS spec(code, n_students, n_sections, ord)
),
picked AS (
  SELECT
    m.id,
    g.id AS grade_id,
    CASE
      WHEN b.code = '11' AND ((m.n - b.lo - 1) % b.n_sections) = 0 THEN 'A (Science)'
      WHEN b.code = '12' AND ((m.n - b.lo - 1) % b.n_sections) = 0 THEN 'A (Commerce)'
      ELSE CHR((65 + ((m.n - b.lo - 1) % b.n_sections))::int)
    END AS section_name
  FROM mayur m
  JOIN bands b ON m.n > b.lo AND m.n <= b.hi
  JOIN grades g
    ON g.tenant_id = '00000000-0000-4000-8000-00000000a501'
   AND g.code = b.code
)
UPDATE enrollments e
SET grade_id = picked.grade_id,
    class_id = c.id,
    updated_at = now()
FROM picked
JOIN classes c
  ON c.tenant_id = '00000000-0000-4000-8000-00000000a501'
 AND c.institution_id = '00000000-0000-4000-8000-00000000a551'
 AND c.grade_id = picked.grade_id
 AND c.name = picked.section_name
 AND c.deleted_at IS NULL
WHERE e.id = picked.id;

UPDATE student_attendance a
SET class_id = e.class_id
FROM enrollments e
WHERE a.tenant_id = e.tenant_id
  AND a.student_id = e.student_id
  AND a.institution_id = e.institution_id
  AND e.institution_id = '00000000-0000-4000-8000-00000000a551'
  AND a.class_id IS DISTINCT FROM e.class_id;

UPDATE bell_periods bp
SET start_time = spec.start_time,
    end_time = spec.end_time,
    name = 'Period ' || spec.n::text,
    updated_at = now()
FROM (
  VALUES
    (1, TIME '07:40', TIME '08:20'),
    (2, TIME '08:30', TIME '09:10'),
    (3, TIME '09:20', TIME '10:00'),
    (4, TIME '10:20', TIME '11:00'),
    (5, TIME '11:10', TIME '11:50'),
    (6, TIME '12:00', TIME '12:40')
) AS spec(n, start_time, end_time)
WHERE bp.id = uuid_generate_v5('6ba7b810-9dad-11d1-80b4-00c04fd430c8'::uuid, 'sunrise-period-mv-' || spec.n::text);

UPDATE rooms
SET code = spec.code, name = spec.name, updated_at = now()
FROM (
  VALUES
    (1, 'R201', 'Room 201'),
    (2, 'R202', 'Room 202'),
    (3, 'R203', 'Room 203'),
    (4, 'R301', 'Room 301'),
    (5, 'R302', 'Room 302'),
    (6, 'R401', 'Room 401'),
    (7, 'R105', 'Room 105'),
    (8, 'L1', 'Physics lab')
) AS spec(n, code, name)
WHERE rooms.id = uuid_generate_v5('6ba7b810-9dad-11d1-80b4-00c04fd430c8'::uuid, 'sunrise-room-mv-' || spec.n::text);

UPDATE sections
SET code = 'G8C-HIN',
    name = 'Class 8-C Hindi',
    grade_id = '00000000-0000-4000-8000-00000000a541',
    status = 'ARCHIVED',
    capacity = 40,
    default_room_id = uuid_generate_v5('6ba7b810-9dad-11d1-80b4-00c04fd430c8'::uuid, 'sunrise-room-mv-7'),
    updated_at = now()
WHERE id = '00000000-0000-4000-8000-00000000a571';

UPDATE sections
SET code = 'G9B-MATH',
    name = 'Class 9-B Mathematics',
    grade_id = '00000000-0000-4000-8000-00000000a542',
    status = 'PUBLISHED',
    capacity = 40,
    primary_teacher_id = '00000000-0000-4000-8000-00000000a593',
    default_room_id = uuid_generate_v5('6ba7b810-9dad-11d1-80b4-00c04fd430c8'::uuid, 'sunrise-room-mv-2'),
    published_at = COALESCE(published_at, TIMESTAMPTZ '2026-09-24 11:00:00+05:30'),
    updated_at = now()
WHERE id = '00000000-0000-4000-8000-00000000a572';

UPDATE sections
SET code = 'G10A-ENG',
    name = 'Class 10-A English',
    grade_id = '00000000-0000-4000-8000-00000000a543',
    status = 'DRAFT',
    capacity = 42,
    primary_teacher_id = '00000000-0000-4000-8000-00000000a595',
    default_room_id = NULL,
    published_at = NULL,
    updated_at = now()
WHERE id = '00000000-0000-4000-8000-00000000a573';

UPDATE sections
SET name = 'Class 9-B Science',
    code = 'G9B-SCI',
    status = 'DRAFT',
    default_room_id = uuid_generate_v5('6ba7b810-9dad-11d1-80b4-00c04fd430c8'::uuid, 'sunrise-room-mv-8'),
    primary_teacher_id = '00000000-0000-4000-8000-00000000a593',
    updated_at = now()
WHERE id = uuid_generate_v5('6ba7b810-9dad-11d1-80b4-00c04fd430c8'::uuid, 'sunrise-section-g9b-sci');

INSERT INTO sections (
  id, tenant_id, institution_id, academic_period_id, grade_id, code, name,
  primary_teacher_id, default_room_id, capacity, status, published_at
)
VALUES
  (
    uuid_generate_v5('6ba7b810-9dad-11d1-80b4-00c04fd430c8'::uuid, 'sunrise-section-g9a-math'),
    '00000000-0000-4000-8000-00000000a501',
    '00000000-0000-4000-8000-00000000a551',
    '00000000-0000-4000-8000-00000000a531',
    '00000000-0000-4000-8000-00000000a542',
    'G9A-MATH',
    'Class 9-A Mathematics',
    '00000000-0000-4000-8000-00000000a593',
    uuid_generate_v5('6ba7b810-9dad-11d1-80b4-00c04fd430c8'::uuid, 'sunrise-room-mv-1'),
    40,
    'PUBLISHED',
    TIMESTAMPTZ '2026-09-24 11:00:00+05:30'
  ),
  (
    uuid_generate_v5('6ba7b810-9dad-11d1-80b4-00c04fd430c8'::uuid, 'sunrise-section-g11a-phy'),
    '00000000-0000-4000-8000-00000000a501',
    '00000000-0000-4000-8000-00000000a551',
    '00000000-0000-4000-8000-00000000a531',
    uuid_generate_v5('6ba7b810-9dad-11d1-80b4-00c04fd430c8'::uuid, 'sunrise-grade-11'),
    'G11A-PHY',
    'Class 11-A Physics',
    '00000000-0000-4000-8000-00000000a597',
    uuid_generate_v5('6ba7b810-9dad-11d1-80b4-00c04fd430c8'::uuid, 'sunrise-room-mv-8'),
    36,
    'PUBLISHED',
    TIMESTAMPTZ '2026-09-24 11:00:00+05:30'
  )
ON CONFLICT (id) DO UPDATE
SET code = EXCLUDED.code,
    name = EXCLUDED.name,
    status = EXCLUDED.status,
    default_room_id = EXCLUDED.default_room_id,
    primary_teacher_id = EXCLUDED.primary_teacher_id,
    capacity = EXCLUDED.capacity,
    grade_id = EXCLUDED.grade_id,
    updated_at = now();

DELETE FROM section_meetings
WHERE tenant_id = '00000000-0000-4000-8000-00000000a501'
  AND section_id IN (
    '00000000-0000-4000-8000-00000000a571',
    '00000000-0000-4000-8000-00000000a572',
    '00000000-0000-4000-8000-00000000a573',
    uuid_generate_v5('6ba7b810-9dad-11d1-80b4-00c04fd430c8'::uuid, 'sunrise-section-g9b-sci'),
    uuid_generate_v5('6ba7b810-9dad-11d1-80b4-00c04fd430c8'::uuid, 'sunrise-section-g9a-math'),
    uuid_generate_v5('6ba7b810-9dad-11d1-80b4-00c04fd430c8'::uuid, 'sunrise-section-g11a-phy')
  );

INSERT INTO section_meetings (
  id, tenant_id, section_id, bell_period_id, day_of_week, room_id, teacher_staff_id, status
)
SELECT
  uuid_generate_v5('6ba7b810-9dad-11d1-80b4-00c04fd430c8'::uuid, 'sunrise-mtg-v2-' || spec.key),
  '00000000-0000-4000-8000-00000000a501',
  spec.section_id,
  uuid_generate_v5('6ba7b810-9dad-11d1-80b4-00c04fd430c8'::uuid, 'sunrise-period-mv-' || spec.period::text),
  spec.day,
  CASE
    WHEN spec.room_n IS NULL THEN NULL
    ELSE uuid_generate_v5('6ba7b810-9dad-11d1-80b4-00c04fd430c8'::uuid, 'sunrise-room-mv-' || spec.room_n::text)
  END,
  spec.teacher,
  'active'
FROM (
  VALUES
    ('g9b-mon', '00000000-0000-4000-8000-00000000a572'::uuid, 1, 3, 2, '00000000-0000-4000-8000-00000000a593'::uuid),
    ('g9b-tue', '00000000-0000-4000-8000-00000000a572'::uuid, 2, 1, 2, '00000000-0000-4000-8000-00000000a593'::uuid),
    ('g9b-wed', '00000000-0000-4000-8000-00000000a572'::uuid, 3, 4, 2, '00000000-0000-4000-8000-00000000a593'::uuid),
    ('g9b-thu', '00000000-0000-4000-8000-00000000a572'::uuid, 4, 2, NULL::int, '00000000-0000-4000-8000-00000000a593'::uuid),
    ('g9b-fri', '00000000-0000-4000-8000-00000000a572'::uuid, 5, 6, 2, '00000000-0000-4000-8000-00000000a593'::uuid),
    ('g9a-mon', uuid_generate_v5('6ba7b810-9dad-11d1-80b4-00c04fd430c8'::uuid, 'sunrise-section-g9a-math'), 1, 3, 1, '00000000-0000-4000-8000-00000000a593'::uuid),
    ('g9a-wed', uuid_generate_v5('6ba7b810-9dad-11d1-80b4-00c04fd430c8'::uuid, 'sunrise-section-g9a-math'), 3, 5, 1, '00000000-0000-4000-8000-00000000a593'::uuid),
    ('g10-wed', '00000000-0000-4000-8000-00000000a573'::uuid, 3, 5, 1, '00000000-0000-4000-8000-00000000a595'::uuid)
) AS spec(key, section_id, day, period, room_n, teacher)
ON CONFLICT (section_id, bell_period_id, day_of_week) DO NOTHING;

INSERT INTO section_enrollments (id, tenant_id, section_id, student_id, status, enrolled_at)
SELECT
  uuid_generate_v5('6ba7b810-9dad-11d1-80b4-00c04fd430c8'::uuid, 'sunrise-roster-g9b-' || spec.student_id::text),
  '00000000-0000-4000-8000-00000000a501',
  '00000000-0000-4000-8000-00000000a572',
  spec.student_id,
  spec.status,
  spec.enrolled_at
FROM (
  VALUES
    ('00000000-0000-4000-8000-00000000a5b1'::uuid, 'ENROLLED', DATE '2026-04-01'),
    ('00000000-0000-4000-8000-00000000a5b2'::uuid, 'ENROLLED', DATE '2026-04-01'),
    ('00000000-0000-4000-8000-00000000a5b3'::uuid, 'ENROLLED', DATE '2026-04-01'),
    ('00000000-0000-4000-8000-00000000a5b4'::uuid, 'ENROLLED', DATE '2026-04-03'),
    ('00000000-0000-4000-8000-00000000a5b5'::uuid, 'WITHDRAWN', DATE '2026-04-01')
) AS spec(student_id, status, enrolled_at)
ON CONFLICT (section_id, student_id) DO UPDATE
SET status = EXCLUDED.status, enrolled_at = EXCLUDED.enrolled_at, updated_at = now();

-- Class 9-B week grid (prototype detail-timetable): six subjects, a break
-- row, Saturday half-day free slots, and a few draft meetings. The Neha
-- double-book that the schedule page calls "Teacher clash" stays on G8C-HIN
-- vs G9A-MATH (Mon · P3), outside this grid.
INSERT INTO rooms (id, tenant_id, institution_id, code, name, capacity, room_type, status)
VALUES (
  uuid_generate_v5('6ba7b810-9dad-11d1-80b4-00c04fd430c8'::uuid, 'sunrise-room-lab-c1'),
  '00000000-0000-4000-8000-00000000a501',
  '00000000-0000-4000-8000-00000000a551',
  'LC1',
  'Lab C1',
  36,
  'LAB',
  'active'
)
ON CONFLICT (id) DO UPDATE
SET code = EXCLUDED.code, name = EXCLUDED.name, updated_at = now();

INSERT INTO bell_periods (
  id, tenant_id, bell_schedule_id, code, name, period_order, start_time, end_time, is_break
)
VALUES (
  uuid_generate_v5('6ba7b810-9dad-11d1-80b4-00c04fd430c8'::uuid, 'sunrise-period-mv-break'),
  '00000000-0000-4000-8000-00000000a501',
  uuid_generate_v5('6ba7b810-9dad-11d1-80b4-00c04fd430c8'::uuid, 'sunrise-bell-mv'),
  'BREAK',
  'Break',
  7,
  TIME '10:00',
  TIME '10:20',
  TRUE
)
ON CONFLICT (bell_schedule_id, code) DO UPDATE
SET name = EXCLUDED.name,
    start_time = EXCLUDED.start_time,
    end_time = EXCLUDED.end_time,
    is_break = TRUE,
    updated_at = now();

INSERT INTO sections (
  id, tenant_id, institution_id, academic_period_id, grade_id, code, name,
  primary_teacher_id, default_room_id, capacity, status, published_at
)
SELECT
  uuid_generate_v5('6ba7b810-9dad-11d1-80b4-00c04fd430c8'::uuid, spec.key),
  '00000000-0000-4000-8000-00000000a501',
  '00000000-0000-4000-8000-00000000a551',
  '00000000-0000-4000-8000-00000000a531',
  '00000000-0000-4000-8000-00000000a542',
  spec.code,
  spec.name,
  spec.teacher,
  spec.room_id,
  40,
  'PUBLISHED',
  TIMESTAMPTZ '2026-09-24 11:00:00+05:30'
FROM (
  VALUES
    ('sunrise-section-g9b-eng', 'G9B-ENG', 'Class 9-B English', '00000000-0000-4000-8000-00000000a595'::uuid, uuid_generate_v5('6ba7b810-9dad-11d1-80b4-00c04fd430c8'::uuid, 'sunrise-room-mv-2')),
    ('sunrise-section-g9b-sst', 'G9B-SST', 'Class 9-B Social Science', '00000000-0000-4000-8000-00000000a594'::uuid, uuid_generate_v5('6ba7b810-9dad-11d1-80b4-00c04fd430c8'::uuid, 'sunrise-room-mv-2')),
    ('sunrise-section-g9b-cs', 'G9B-CS', 'Class 9-B Computer Science', '00000000-0000-4000-8000-00000000a591'::uuid, uuid_generate_v5('6ba7b810-9dad-11d1-80b4-00c04fd430c8'::uuid, 'sunrise-room-lab-c1')),
    ('sunrise-section-g9b-hin', 'G9B-HIN', 'Class 9-B Hindi', '00000000-0000-4000-8000-00000000a596'::uuid, uuid_generate_v5('6ba7b810-9dad-11d1-80b4-00c04fd430c8'::uuid, 'sunrise-room-mv-2'))
) AS spec(key, code, name, teacher, room_id)
ON CONFLICT (id) DO UPDATE
SET code = EXCLUDED.code,
    name = EXCLUDED.name,
    primary_teacher_id = EXCLUDED.primary_teacher_id,
    default_room_id = EXCLUDED.default_room_id,
    status = EXCLUDED.status,
    updated_at = now();

UPDATE sections
SET status = 'DRAFT', published_at = NULL, updated_at = now()
WHERE id = uuid_generate_v5('6ba7b810-9dad-11d1-80b4-00c04fd430c8'::uuid, 'sunrise-section-g9b-hin');

UPDATE sections
SET status = 'PUBLISHED',
    published_at = COALESCE(published_at, TIMESTAMPTZ '2026-09-24 11:00:00+05:30'),
    primary_teacher_id = '00000000-0000-4000-8000-00000000a597',
    default_room_id = uuid_generate_v5('6ba7b810-9dad-11d1-80b4-00c04fd430c8'::uuid, 'sunrise-room-mv-8'),
    updated_at = now()
WHERE id = uuid_generate_v5('6ba7b810-9dad-11d1-80b4-00c04fd430c8'::uuid, 'sunrise-section-g9b-sci');

DELETE FROM section_meetings
WHERE tenant_id = '00000000-0000-4000-8000-00000000a501'
  AND section_id IN (
    '00000000-0000-4000-8000-00000000a572',
    uuid_generate_v5('6ba7b810-9dad-11d1-80b4-00c04fd430c8'::uuid, 'sunrise-section-g9b-sci'),
    uuid_generate_v5('6ba7b810-9dad-11d1-80b4-00c04fd430c8'::uuid, 'sunrise-section-g9b-eng'),
    uuid_generate_v5('6ba7b810-9dad-11d1-80b4-00c04fd430c8'::uuid, 'sunrise-section-g9b-sst'),
    uuid_generate_v5('6ba7b810-9dad-11d1-80b4-00c04fd430c8'::uuid, 'sunrise-section-g9b-cs'),
    uuid_generate_v5('6ba7b810-9dad-11d1-80b4-00c04fd430c8'::uuid, 'sunrise-section-g9b-hin')
  );

INSERT INTO section_meetings (
  id, tenant_id, section_id, bell_period_id, day_of_week, room_id, teacher_staff_id, status
)
SELECT
  uuid_generate_v5('6ba7b810-9dad-11d1-80b4-00c04fd430c8'::uuid, 'sunrise-mtg-grid-' || spec.key),
  '00000000-0000-4000-8000-00000000a501',
  spec.section_id,
  uuid_generate_v5('6ba7b810-9dad-11d1-80b4-00c04fd430c8'::uuid, 'sunrise-period-mv-' || spec.period::text),
  spec.day,
  spec.room_id,
  spec.teacher,
  spec.status
FROM (
  VALUES
    ('p1d1', '00000000-0000-4000-8000-00000000a572'::uuid, 1, 1, uuid_generate_v5('6ba7b810-9dad-11d1-80b4-00c04fd430c8'::uuid, 'sunrise-room-mv-2'), '00000000-0000-4000-8000-00000000a593'::uuid, 'draft'),
    ('p1d2', uuid_generate_v5('6ba7b810-9dad-11d1-80b4-00c04fd430c8'::uuid, 'sunrise-section-g9b-eng'), 2, 1, uuid_generate_v5('6ba7b810-9dad-11d1-80b4-00c04fd430c8'::uuid, 'sunrise-room-mv-2'), '00000000-0000-4000-8000-00000000a595'::uuid, 'active'),
    ('p1d3', uuid_generate_v5('6ba7b810-9dad-11d1-80b4-00c04fd430c8'::uuid, 'sunrise-section-g9b-sst'), 3, 1, uuid_generate_v5('6ba7b810-9dad-11d1-80b4-00c04fd430c8'::uuid, 'sunrise-room-mv-2'), '00000000-0000-4000-8000-00000000a594'::uuid, 'active'),
    ('p1d4', '00000000-0000-4000-8000-00000000a572'::uuid, 4, 1, uuid_generate_v5('6ba7b810-9dad-11d1-80b4-00c04fd430c8'::uuid, 'sunrise-room-mv-2'), '00000000-0000-4000-8000-00000000a593'::uuid, 'active'),
    ('p1d5', uuid_generate_v5('6ba7b810-9dad-11d1-80b4-00c04fd430c8'::uuid, 'sunrise-section-g9b-eng'), 5, 1, uuid_generate_v5('6ba7b810-9dad-11d1-80b4-00c04fd430c8'::uuid, 'sunrise-room-mv-2'), '00000000-0000-4000-8000-00000000a595'::uuid, 'active'),
    ('p2d1', uuid_generate_v5('6ba7b810-9dad-11d1-80b4-00c04fd430c8'::uuid, 'sunrise-section-g9b-cs'), 1, 2, uuid_generate_v5('6ba7b810-9dad-11d1-80b4-00c04fd430c8'::uuid, 'sunrise-room-lab-c1'), '00000000-0000-4000-8000-00000000a591'::uuid, 'active'),
    ('p2d2', uuid_generate_v5('6ba7b810-9dad-11d1-80b4-00c04fd430c8'::uuid, 'sunrise-section-g9b-sci'), 2, 2, uuid_generate_v5('6ba7b810-9dad-11d1-80b4-00c04fd430c8'::uuid, 'sunrise-room-mv-8'), '00000000-0000-4000-8000-00000000a597'::uuid, 'active'),
    ('p2d3', uuid_generate_v5('6ba7b810-9dad-11d1-80b4-00c04fd430c8'::uuid, 'sunrise-section-g9b-hin'), 3, 2, uuid_generate_v5('6ba7b810-9dad-11d1-80b4-00c04fd430c8'::uuid, 'sunrise-room-mv-2'), '00000000-0000-4000-8000-00000000a596'::uuid, 'active'),
    ('p2d4', uuid_generate_v5('6ba7b810-9dad-11d1-80b4-00c04fd430c8'::uuid, 'sunrise-section-g9b-cs'), 4, 2, uuid_generate_v5('6ba7b810-9dad-11d1-80b4-00c04fd430c8'::uuid, 'sunrise-room-lab-c1'), '00000000-0000-4000-8000-00000000a591'::uuid, 'active'),
    ('p2d5', uuid_generate_v5('6ba7b810-9dad-11d1-80b4-00c04fd430c8'::uuid, 'sunrise-section-g9b-sci'), 5, 2, uuid_generate_v5('6ba7b810-9dad-11d1-80b4-00c04fd430c8'::uuid, 'sunrise-room-mv-8'), '00000000-0000-4000-8000-00000000a597'::uuid, 'active'),
    ('p2d6', uuid_generate_v5('6ba7b810-9dad-11d1-80b4-00c04fd430c8'::uuid, 'sunrise-section-g9b-hin'), 6, 2, uuid_generate_v5('6ba7b810-9dad-11d1-80b4-00c04fd430c8'::uuid, 'sunrise-room-mv-2'), '00000000-0000-4000-8000-00000000a596'::uuid, 'active'),
    ('p3d1', uuid_generate_v5('6ba7b810-9dad-11d1-80b4-00c04fd430c8'::uuid, 'sunrise-section-g9b-sst'), 1, 3, uuid_generate_v5('6ba7b810-9dad-11d1-80b4-00c04fd430c8'::uuid, 'sunrise-room-mv-2'), '00000000-0000-4000-8000-00000000a594'::uuid, 'active'),
    ('p3d2', '00000000-0000-4000-8000-00000000a572'::uuid, 2, 3, uuid_generate_v5('6ba7b810-9dad-11d1-80b4-00c04fd430c8'::uuid, 'sunrise-room-mv-2'), '00000000-0000-4000-8000-00000000a593'::uuid, 'active'),
    ('p3d3', uuid_generate_v5('6ba7b810-9dad-11d1-80b4-00c04fd430c8'::uuid, 'sunrise-section-g9b-eng'), 3, 3, uuid_generate_v5('6ba7b810-9dad-11d1-80b4-00c04fd430c8'::uuid, 'sunrise-room-mv-2'), '00000000-0000-4000-8000-00000000a595'::uuid, 'active'),
    ('p3d4', uuid_generate_v5('6ba7b810-9dad-11d1-80b4-00c04fd430c8'::uuid, 'sunrise-section-g9b-sst'), 4, 3, uuid_generate_v5('6ba7b810-9dad-11d1-80b4-00c04fd430c8'::uuid, 'sunrise-room-mv-2'), '00000000-0000-4000-8000-00000000a594'::uuid, 'active'),
    ('p3d6', uuid_generate_v5('6ba7b810-9dad-11d1-80b4-00c04fd430c8'::uuid, 'sunrise-section-g9b-eng'), 6, 3, uuid_generate_v5('6ba7b810-9dad-11d1-80b4-00c04fd430c8'::uuid, 'sunrise-room-mv-2'), '00000000-0000-4000-8000-00000000a595'::uuid, 'active'),
    ('p4d1', uuid_generate_v5('6ba7b810-9dad-11d1-80b4-00c04fd430c8'::uuid, 'sunrise-section-g9b-eng'), 1, 4, uuid_generate_v5('6ba7b810-9dad-11d1-80b4-00c04fd430c8'::uuid, 'sunrise-room-mv-2'), '00000000-0000-4000-8000-00000000a595'::uuid, 'active'),
    ('p4d2', uuid_generate_v5('6ba7b810-9dad-11d1-80b4-00c04fd430c8'::uuid, 'sunrise-section-g9b-sst'), 2, 4, uuid_generate_v5('6ba7b810-9dad-11d1-80b4-00c04fd430c8'::uuid, 'sunrise-room-mv-2'), '00000000-0000-4000-8000-00000000a594'::uuid, 'active'),
    ('p4d3', '00000000-0000-4000-8000-00000000a572'::uuid, 3, 4, uuid_generate_v5('6ba7b810-9dad-11d1-80b4-00c04fd430c8'::uuid, 'sunrise-room-mv-2'), '00000000-0000-4000-8000-00000000a593'::uuid, 'active'),
    ('p4d5', uuid_generate_v5('6ba7b810-9dad-11d1-80b4-00c04fd430c8'::uuid, 'sunrise-section-g9b-sst'), 5, 4, uuid_generate_v5('6ba7b810-9dad-11d1-80b4-00c04fd430c8'::uuid, 'sunrise-room-mv-2'), '00000000-0000-4000-8000-00000000a594'::uuid, 'active'),
    ('p4d6', '00000000-0000-4000-8000-00000000a572'::uuid, 6, 4, uuid_generate_v5('6ba7b810-9dad-11d1-80b4-00c04fd430c8'::uuid, 'sunrise-room-mv-2'), '00000000-0000-4000-8000-00000000a593'::uuid, 'draft'),
    ('p5d1', uuid_generate_v5('6ba7b810-9dad-11d1-80b4-00c04fd430c8'::uuid, 'sunrise-section-g9b-sci'), 1, 5, uuid_generate_v5('6ba7b810-9dad-11d1-80b4-00c04fd430c8'::uuid, 'sunrise-room-mv-8'), '00000000-0000-4000-8000-00000000a597'::uuid, 'active'),
    ('p5d2', uuid_generate_v5('6ba7b810-9dad-11d1-80b4-00c04fd430c8'::uuid, 'sunrise-section-g9b-hin'), 2, 5, uuid_generate_v5('6ba7b810-9dad-11d1-80b4-00c04fd430c8'::uuid, 'sunrise-room-mv-2'), '00000000-0000-4000-8000-00000000a596'::uuid, 'active'),
    ('p5d3', uuid_generate_v5('6ba7b810-9dad-11d1-80b4-00c04fd430c8'::uuid, 'sunrise-section-g9b-cs'), 3, 5, uuid_generate_v5('6ba7b810-9dad-11d1-80b4-00c04fd430c8'::uuid, 'sunrise-room-lab-c1'), '00000000-0000-4000-8000-00000000a591'::uuid, 'active'),
    ('p5d4', uuid_generate_v5('6ba7b810-9dad-11d1-80b4-00c04fd430c8'::uuid, 'sunrise-section-g9b-sci'), 4, 5, uuid_generate_v5('6ba7b810-9dad-11d1-80b4-00c04fd430c8'::uuid, 'sunrise-room-mv-8'), '00000000-0000-4000-8000-00000000a597'::uuid, 'active'),
    ('p5d5', uuid_generate_v5('6ba7b810-9dad-11d1-80b4-00c04fd430c8'::uuid, 'sunrise-section-g9b-hin'), 5, 5, uuid_generate_v5('6ba7b810-9dad-11d1-80b4-00c04fd430c8'::uuid, 'sunrise-room-mv-2'), '00000000-0000-4000-8000-00000000a596'::uuid, 'draft'),
    ('p6d1', '00000000-0000-4000-8000-00000000a572'::uuid, 1, 6, uuid_generate_v5('6ba7b810-9dad-11d1-80b4-00c04fd430c8'::uuid, 'sunrise-room-mv-2'), '00000000-0000-4000-8000-00000000a593'::uuid, 'active'),
    ('p6d2', uuid_generate_v5('6ba7b810-9dad-11d1-80b4-00c04fd430c8'::uuid, 'sunrise-section-g9b-eng'), 2, 6, uuid_generate_v5('6ba7b810-9dad-11d1-80b4-00c04fd430c8'::uuid, 'sunrise-room-mv-2'), '00000000-0000-4000-8000-00000000a595'::uuid, 'active'),
    ('p6d4', '00000000-0000-4000-8000-00000000a572'::uuid, 4, 6, uuid_generate_v5('6ba7b810-9dad-11d1-80b4-00c04fd430c8'::uuid, 'sunrise-room-mv-2'), '00000000-0000-4000-8000-00000000a593'::uuid, 'draft'),
    ('p6d5', uuid_generate_v5('6ba7b810-9dad-11d1-80b4-00c04fd430c8'::uuid, 'sunrise-section-g9b-eng'), 5, 6, uuid_generate_v5('6ba7b810-9dad-11d1-80b4-00c04fd430c8'::uuid, 'sunrise-room-mv-2'), '00000000-0000-4000-8000-00000000a595'::uuid, 'active')
) AS spec(key, section_id, day, period, room_id, teacher, status)
ON CONFLICT (section_id, bell_period_id, day_of_week) DO UPDATE
SET room_id = EXCLUDED.room_id,
    teacher_staff_id = EXCLUDED.teacher_staff_id,
    status = EXCLUDED.status,
    deleted_at = NULL,
    updated_at = now();

-- Keep the schedule-page teacher clash: Neha on G9A-MATH and G8C-HIN, Mon · P3.
INSERT INTO section_meetings (
  id, tenant_id, section_id, bell_period_id, day_of_week, room_id, teacher_staff_id, status
)
VALUES (
  uuid_generate_v5('6ba7b810-9dad-11d1-80b4-00c04fd430c8'::uuid, 'sunrise-mtg-clash-g8c'),
  '00000000-0000-4000-8000-00000000a501',
  '00000000-0000-4000-8000-00000000a571',
  uuid_generate_v5('6ba7b810-9dad-11d1-80b4-00c04fd430c8'::uuid, 'sunrise-period-mv-3'),
  1,
  NULL,
  '00000000-0000-4000-8000-00000000a593',
  'active'
)
ON CONFLICT (section_id, bell_period_id, day_of_week) DO UPDATE
SET teacher_staff_id = EXCLUDED.teacher_staff_id, status = 'active', deleted_at = NULL, updated_at = now();

INSERT INTO timetable_teacher_absences (
  id, tenant_id, institution_id, staff_id, absence_date, reason, created_by
)
VALUES (
  uuid_generate_v5('6ba7b810-9dad-11d1-80b4-00c04fd430c8'::uuid, 'sunrise-absence-neha-today'),
  '00000000-0000-4000-8000-00000000a501',
  '00000000-0000-4000-8000-00000000a551',
  '00000000-0000-4000-8000-00000000a593',
  CURRENT_DATE,
  'Sick leave',
  'priya-sharma'
)
ON CONFLICT (id) DO UPDATE
SET absence_date = EXCLUDED.absence_date, reason = EXCLUDED.reason;

INSERT INTO substitutions (
  id, tenant_id, section_meeting_id, original_staff_id, substitute_staff_id,
  substitution_date, reason, status
)
SELECT
  uuid_generate_v5('6ba7b810-9dad-11d1-80b4-00c04fd430c8'::uuid, 'sunrise-sub-neha-today'),
  '00000000-0000-4000-8000-00000000a501',
  m.id,
  '00000000-0000-4000-8000-00000000a593',
  '00000000-0000-4000-8000-00000000a594',
  CURRENT_DATE,
  'Sick leave',
  'SCHEDULED'
FROM section_meetings m
WHERE m.tenant_id = '00000000-0000-4000-8000-00000000a501'
  AND m.teacher_staff_id = '00000000-0000-4000-8000-00000000a593'
  AND m.day_of_week = EXTRACT(ISODOW FROM CURRENT_DATE)::int
  AND m.deleted_at IS NULL
  AND m.section_id = '00000000-0000-4000-8000-00000000a572'
ORDER BY m.bell_period_id
LIMIT 1
ON CONFLICT (id) DO UPDATE
SET section_meeting_id = EXCLUDED.section_meeting_id,
    substitution_date = EXCLUDED.substitution_date,
    substitute_staff_id = EXCLUDED.substitute_staff_id,
    reason = EXCLUDED.reason,
    status = 'SCHEDULED',
    updated_at = now();

INSERT INTO audit_log_entries (
  id, tenant_id, entity_type, entity_id, operation, user_id, user_name,
  ip_address, occurred_at, metadata
)
SELECT
  uuid_generate_v5(
    '6ba7b810-9dad-11d1-80b4-00c04fd430c8'::uuid,
    'sunrise-audit-mv-' || item.n::text
  ),
  '00000000-0000-4000-8000-00000000a501',
  'institution',
  '00000000-0000-4000-8000-00000000a551',
  'UPDATE',
  'priya-sharma',
  item.actor,
  '127.0.0.1',
  item.occurred_at,
  jsonb_build_object(
    'title', item.title,
    'tone', item.tone,
    'institutionId', '00000000-0000-4000-8000-00000000a551'
  )
FROM (
  VALUES
    (1, 'Attendance submitted for class sections'::text, 'green'::text, 'Priya Sharma'::text, TIMESTAMPTZ '2026-09-28 09:42:00+05:30'),
    (2, 'Term 2 timetable published', 'brand', 'Priya Sharma', TIMESTAMPTZ '2026-09-24 11:00:00+05:30'),
    (3, 'Room 204 flagged for repair in the facility register', 'amber', 'Sunil Rao', TIMESTAMPTZ '2026-09-22 15:10:00+05:30'),
    (4, 'Class sections confirmed for the active academic period', 'brand', 'Priya Sharma', TIMESTAMPTZ '2026-09-18 10:00:00+05:30')
) AS item(n, title, tone, actor, occurred_at)
ON CONFLICT (id) DO NOTHING;

-- Institution detail tabs: Class 9-B Mathematics gradebook, MATH curriculum, facility tree.
-- Idempotent. Tenant a501 / institution a551.

-- CBSE board grading scale (report cards need boardId from listGradingScales).
-- Letter grades on entries are stored directly; the scale drives report-card bands.
INSERT INTO grading_scales (
  id, tenant_id, board_id, code, name, scale_type, is_default, metadata
)
VALUES (
  '00000000-0000-4000-8000-00000000a5c1',
  '00000000-0000-4000-8000-00000000a501',
  '00000000-0000-4000-8000-00000000a521',
  'CBSE-9PT',
  'CBSE 9-point scale',
  'PERCENT_BAND',
  TRUE,
  '{"board":"CBSE","source":"006_sunrise_public_school_demo"}'::jsonb
)
ON CONFLICT (tenant_id, board_id, code) DO UPDATE
SET name = EXCLUDED.name,
    scale_type = EXCLUDED.scale_type,
    is_default = EXCLUDED.is_default,
    metadata = EXCLUDED.metadata,
    deleted_at = NULL,
    updated_at = now();

INSERT INTO grading_scale_bands (
  id, tenant_id, grading_scale_id, label, min_percent, max_percent, grade_points, sort_order
)
SELECT
  uuid_generate_v5('6ba7b810-9dad-11d1-80b4-00c04fd430c8'::uuid, 'sunrise-gb-band-' || v.label),
  '00000000-0000-4000-8000-00000000a501'::uuid,
  '00000000-0000-4000-8000-00000000a5c1'::uuid,
  v.label,
  v.min_p,
  v.max_p,
  v.gp,
  v.ord
FROM (VALUES
  ('A1'::text, 91.00::numeric, 100.00::numeric, 10.00::numeric, 1::smallint),
  ('A2', 81.00, 90.99, 9.00, 2),
  ('B1', 71.00, 80.99, 8.00, 3),
  ('B2', 61.00, 70.99, 7.00, 4),
  ('C1', 51.00, 60.99, 6.00, 5),
  ('C2', 41.00, 50.99, 5.00, 6),
  ('D',  33.00, 40.99, 4.00, 7),
  ('E',   0.00, 32.99, 0.00, 8)
) AS v(label, min_p, max_p, gp, ord)
ON CONFLICT (grading_scale_id, label) DO UPDATE
SET min_percent = EXCLUDED.min_percent,
    max_percent = EXCLUDED.max_percent,
    grade_points = EXCLUDED.grade_points,
    sort_order = EXCLUDED.sort_order,
    updated_at = now();

UPDATE students
SET custom_data = COALESCE(custom_data, '{}'::jsonb) || '{"gradebookCode":"SPS-2018-0142"}'::jsonb,
    updated_at = now()
WHERE id = '00000000-0000-4000-8000-00000000a5b1'::uuid
  AND tenant_id = '00000000-0000-4000-8000-00000000a501'::uuid;

UPDATE students
SET custom_data = COALESCE(custom_data, '{}'::jsonb) || '{"gradebookCode":"SPS-2018-0201"}'::jsonb,
    updated_at = now()
WHERE id = '00000000-0000-4000-8000-00000000a5b2'::uuid
  AND tenant_id = '00000000-0000-4000-8000-00000000a501'::uuid;

INSERT INTO students (
  id, tenant_id, first_name, last_name, date_of_birth, gender, national_id, admission_number, custom_data
)
SELECT
  uuid_generate_v5('6ba7b810-9dad-11d1-80b4-00c04fd430c8'::uuid, 'sunrise-gb-student-' || spec.code),
  '00000000-0000-4000-8000-00000000a501'::uuid,
  spec.first_name,
  spec.last_name,
  spec.dob,
  spec.gender,
  spec.code,
  spec.code,
  jsonb_build_object('gradebookCode', spec.code)
FROM (
  VALUES
    ('Ishita'::text, 'Rao'::text, DATE '2011-02-14', 'FEMALE'::text, 'SPS-2019-0388'::text),
    ('Kabir', 'Singh', DATE '2011-07-09', 'MALE', 'SPS-2019-0411'),
    ('Rohan', 'Gupta', DATE '2011-11-21', 'MALE', 'SPS-2019-0550'),
    ('Sara', 'Khan', DATE '2011-05-03', 'FEMALE', 'SPS-2019-0602')
) AS spec(first_name, last_name, dob, gender, code)
ON CONFLICT (id) DO UPDATE
SET first_name = EXCLUDED.first_name,
    last_name = EXCLUDED.last_name,
    custom_data = EXCLUDED.custom_data,
    updated_at = now();

INSERT INTO section_enrollments (id, tenant_id, section_id, student_id, status, enrolled_at)
SELECT
  uuid_generate_v5('6ba7b810-9dad-11d1-80b4-00c04fd430c8'::uuid, 'sunrise-gb-enroll-' || spec.code),
  '00000000-0000-4000-8000-00000000a501'::uuid,
  '00000000-0000-4000-8000-00000000a572'::uuid,
  uuid_generate_v5('6ba7b810-9dad-11d1-80b4-00c04fd430c8'::uuid, 'sunrise-gb-student-' || spec.code),
  'ENROLLED',
  DATE '2026-04-01'
FROM (VALUES ('SPS-2019-0388'), ('SPS-2019-0411'), ('SPS-2019-0550'), ('SPS-2019-0602')) AS spec(code)
ON CONFLICT (section_id, student_id) DO UPDATE
SET status = 'ENROLLED', updated_at = now();

INSERT INTO grade_entries (
  id, tenant_id, student_id, section_id, assessment_code, numeric_score, letter_grade,
  entered_at, locked_at, published_at, metadata
)
SELECT
  uuid_generate_v5('6ba7b810-9dad-11d1-80b4-00c04fd430c8'::uuid, 'sunrise-gb-entry-' || spec.student_key),
  '00000000-0000-4000-8000-00000000a501'::uuid,
  spec.student_id,
  '00000000-0000-4000-8000-00000000a572'::uuid,
  'MATH',
  spec.score,
  spec.letter,
  TIMESTAMPTZ '2026-09-20 10:00:00+05:30',
  spec.locked_at,
  spec.published_at,
  jsonb_build_object(
    'workflowStatus', spec.status,
    'remark', spec.remark,
    'rank', spec.rank,
    'cgpa', spec.cgpa,
    'published', spec.status = 'PUBLISHED'
  )
FROM (
  VALUES
    ('aarav'::text, '00000000-0000-4000-8000-00000000a5b1'::uuid, 91.50::numeric, 'A1'::text, 'PUBLISHED'::text, NULL::text, 1::int, 9.6::numeric, TIMESTAMPTZ '2026-09-21 09:00:00+05:30', TIMESTAMPTZ '2026-09-22 09:00:00+05:30'),
    ('ishita', uuid_generate_v5('6ba7b810-9dad-11d1-80b4-00c04fd430c8'::uuid, 'sunrise-gb-student-SPS-2019-0388'), 88.00, 'A2', 'LOCKED', NULL, 2, 9.2, TIMESTAMPTZ '2026-09-21 09:00:00+05:30', NULL),
    ('kabir', uuid_generate_v5('6ba7b810-9dad-11d1-80b4-00c04fd430c8'::uuid, 'sunrise-gb-student-SPS-2019-0411'), 84.50, 'A2', 'APPROVED', 'Consistent effort', 3, 8.9, NULL, NULL),
    ('diya', '00000000-0000-4000-8000-00000000a5b2'::uuid, 79.00, 'B1', 'SUBMITTED', NULL, 4, 8.4, NULL, NULL),
    ('sara', uuid_generate_v5('6ba7b810-9dad-11d1-80b4-00c04fd430c8'::uuid, 'sunrise-gb-student-SPS-2019-0602'), 71.00, 'B2', 'DRAFT', NULL, 5, 7.8, NULL, NULL),
    ('rohan', uuid_generate_v5('6ba7b810-9dad-11d1-80b4-00c04fd430c8'::uuid, 'sunrise-gb-student-SPS-2019-0550'), 62.00, 'B2', 'REJECTED', 'Recheck internal marks', 6, 7.1, NULL, NULL)
) AS spec(student_key, student_id, score, letter, status, remark, rank, cgpa, locked_at, published_at)
ON CONFLICT (id) DO UPDATE
SET numeric_score = EXCLUDED.numeric_score,
    letter_grade = EXCLUDED.letter_grade,
    locked_at = EXCLUDED.locked_at,
    published_at = EXCLUDED.published_at,
    metadata = EXCLUDED.metadata,
    updated_at = now();

INSERT INTO comments_bank (id, tenant_id, institution_id, subject_id, grade_band, label, body)
VALUES
  (
    uuid_generate_v5('6ba7b810-9dad-11d1-80b4-00c04fd430c8'::uuid, 'sunrise-comment-a1'),
    '00000000-0000-4000-8000-00000000a501'::uuid,
    '00000000-0000-4000-8000-00000000a551'::uuid,
    '00000000-0000-4000-8000-00000000a581'::uuid,
    'A1',
    'Excellent grasp of concepts',
    'Excellent grasp of concepts'
  ),
  (
    uuid_generate_v5('6ba7b810-9dad-11d1-80b4-00c04fd430c8'::uuid, 'sunrise-comment-b2'),
    '00000000-0000-4000-8000-00000000a501'::uuid,
    '00000000-0000-4000-8000-00000000a551'::uuid,
    '00000000-0000-4000-8000-00000000a581'::uuid,
    'B2',
    'Needs regular practice',
    'Needs regular practice'
  )
ON CONFLICT (id) DO UPDATE SET label = EXCLUDED.label, body = EXCLUDED.body;

INSERT INTO class_rank_snapshots (
  id, tenant_id, section_id, academic_period_id, batch_id, student_id, class_rank, cgpa, computed_at
)
SELECT
  uuid_generate_v5('6ba7b810-9dad-11d1-80b4-00c04fd430c8'::uuid, 'sunrise-rank-' || spec.student_key),
  '00000000-0000-4000-8000-00000000a501'::uuid,
  '00000000-0000-4000-8000-00000000a572'::uuid,
  '00000000-0000-4000-8000-00000000a531'::uuid,
  uuid_generate_v5('6ba7b810-9dad-11d1-80b4-00c04fd430c8'::uuid, 'sunrise-rank-batch'),
  spec.student_id::text,
  spec.rank,
  spec.score,
  TIMESTAMPTZ '2026-09-22 12:00:00+05:30'
FROM (
  VALUES
    ('aarav'::text, '00000000-0000-4000-8000-00000000a5b1'::uuid, 1::int, 91.50::numeric),
    ('ishita', uuid_generate_v5('6ba7b810-9dad-11d1-80b4-00c04fd430c8'::uuid, 'sunrise-gb-student-SPS-2019-0388'), 2, 88.00),
    ('kabir', uuid_generate_v5('6ba7b810-9dad-11d1-80b4-00c04fd430c8'::uuid, 'sunrise-gb-student-SPS-2019-0411'), 3, 84.50),
    ('diya', '00000000-0000-4000-8000-00000000a5b2'::uuid, 4, 79.00),
    ('sara', uuid_generate_v5('6ba7b810-9dad-11d1-80b4-00c04fd430c8'::uuid, 'sunrise-gb-student-SPS-2019-0602'), 5, 71.00),
    ('rohan', uuid_generate_v5('6ba7b810-9dad-11d1-80b4-00c04fd430c8'::uuid, 'sunrise-gb-student-SPS-2019-0550'), 6, 62.00)
) AS spec(student_key, student_id, rank, score)
ON CONFLICT (id) DO UPDATE SET class_rank = EXCLUDED.class_rank, cgpa = EXCLUDED.cgpa, computed_at = EXCLUDED.computed_at;

INSERT INTO gpa_snapshots (
  id, tenant_id, student_id, academic_period_id, weighted_gpa, unweighted_gpa, credits_earned, computed_at
)
SELECT
  uuid_generate_v5('6ba7b810-9dad-11d1-80b4-00c04fd430c8'::uuid, 'sunrise-gpa-' || spec.student_key),
  '00000000-0000-4000-8000-00000000a501'::uuid,
  spec.student_id,
  '00000000-0000-4000-8000-00000000a531'::uuid,
  spec.cgpa,
  spec.cgpa,
  5,
  TIMESTAMPTZ '2026-09-22 12:00:00+05:30'
FROM (
  VALUES
    ('aarav'::text, '00000000-0000-4000-8000-00000000a5b1'::uuid, 9.6::numeric),
    ('ishita', uuid_generate_v5('6ba7b810-9dad-11d1-80b4-00c04fd430c8'::uuid, 'sunrise-gb-student-SPS-2019-0388'), 9.2),
    ('kabir', uuid_generate_v5('6ba7b810-9dad-11d1-80b4-00c04fd430c8'::uuid, 'sunrise-gb-student-SPS-2019-0411'), 8.9),
    ('diya', '00000000-0000-4000-8000-00000000a5b2'::uuid, 8.4),
    ('sara', uuid_generate_v5('6ba7b810-9dad-11d1-80b4-00c04fd430c8'::uuid, 'sunrise-gb-student-SPS-2019-0602'), 7.8),
    ('rohan', uuid_generate_v5('6ba7b810-9dad-11d1-80b4-00c04fd430c8'::uuid, 'sunrise-gb-student-SPS-2019-0550'), 7.1)
) AS spec(student_key, student_id, cgpa)
ON CONFLICT (id) DO UPDATE
SET weighted_gpa = EXCLUDED.weighted_gpa, unweighted_gpa = EXCLUDED.unweighted_gpa, computed_at = EXCLUDED.computed_at;

INSERT INTO board_export_jobs (
  id, tenant_id, board_id, institution_id, job_type, status, requested_by,
  finished_at, artifact_uri, error_message, metadata
)
VALUES
  (
    uuid_generate_v5('6ba7b810-9dad-11d1-80b4-00c04fd430c8'::uuid, 'sunrise-rc-aarav'),
    '00000000-0000-4000-8000-00000000a501'::uuid,
    '00000000-0000-4000-8000-00000000a521'::uuid,
    '00000000-0000-4000-8000-00000000a551'::uuid,
    'REPORT_CARD',
    'SUCCEEDED',
    NULL,
    TIMESTAMPTZ '2026-09-22 16:00:00+05:30',
    'gradebook://report-cards/aarav-mehta',
    NULL,
    jsonb_build_object('studentId', '00000000-0000-4000-8000-00000000a5b1', 'term', 'Term 1', 'studentName', 'Aarav Mehta')
  ),
  (
    uuid_generate_v5('6ba7b810-9dad-11d1-80b4-00c04fd430c8'::uuid, 'sunrise-rc-ishita'),
    '00000000-0000-4000-8000-00000000a501'::uuid,
    '00000000-0000-4000-8000-00000000a521'::uuid,
    '00000000-0000-4000-8000-00000000a551'::uuid,
    'REPORT_CARD',
    'QUEUED',
    NULL,
    NULL,
    NULL,
    NULL,
    jsonb_build_object(
      'studentId', uuid_generate_v5('6ba7b810-9dad-11d1-80b4-00c04fd430c8'::uuid, 'sunrise-gb-student-SPS-2019-0388')::text,
      'term', 'Term 1',
      'studentName', 'Ishita Rao'
    )
  ),
  (
    uuid_generate_v5('6ba7b810-9dad-11d1-80b4-00c04fd430c8'::uuid, 'sunrise-rc-rohan'),
    '00000000-0000-4000-8000-00000000a501'::uuid,
    '00000000-0000-4000-8000-00000000a521'::uuid,
    '00000000-0000-4000-8000-00000000a551'::uuid,
    'REPORT_CARD',
    'FAILED',
    NULL,
    TIMESTAMPTZ '2026-09-22 16:10:00+05:30',
    NULL,
    'grades not published',
    jsonb_build_object(
      'studentId', uuid_generate_v5('6ba7b810-9dad-11d1-80b4-00c04fd430c8'::uuid, 'sunrise-gb-student-SPS-2019-0550')::text,
      'term', 'Term 1',
      'studentName', 'Rohan Gupta'
    )
  )
ON CONFLICT (id) DO UPDATE
SET status = EXCLUDED.status,
    artifact_uri = EXCLUDED.artifact_uri,
    error_message = EXCLUDED.error_message,
    metadata = EXCLUDED.metadata,
    updated_at = now();

INSERT INTO syllabus_units (
  id, tenant_id, institution_id, subject_id, grade_id, academic_period_id, code, name, sequence, planned, notes
)
SELECT
  uuid_generate_v5('6ba7b810-9dad-11d1-80b4-00c04fd430c8'::uuid, 'sunrise-unit-' || spec.code),
  '00000000-0000-4000-8000-00000000a501'::uuid,
  '00000000-0000-4000-8000-00000000a551'::uuid,
  '00000000-0000-4000-8000-00000000a581'::uuid,
  '00000000-0000-4000-8000-00000000a542'::uuid,
  '00000000-0000-4000-8000-00000000a531'::uuid,
  spec.code,
  spec.name,
  spec.sequence,
  true,
  spec.notes
FROM (
  VALUES
    ('U1'::text, 'Number systems'::text, 1::int, NULL::text),
    ('U2', 'Polynomials', 2, NULL),
    ('U3', 'Coordinate geometry', 3, NULL),
    ('U4', 'Linear equations', 4, NULL)
) AS spec(code, name, sequence, notes)
ON CONFLICT (tenant_id, subject_id, grade_id, academic_period_id, code) DO UPDATE
SET name = EXCLUDED.name, sequence = EXCLUDED.sequence, planned = true, updated_at = now();

INSERT INTO unit_coverage (id, tenant_id, unit_id, taught_at, taught_by)
SELECT
  uuid_generate_v5('6ba7b810-9dad-11d1-80b4-00c04fd430c8'::uuid, 'sunrise-coverage-' || spec.code),
  '00000000-0000-4000-8000-00000000a501'::uuid,
  uuid_generate_v5('6ba7b810-9dad-11d1-80b4-00c04fd430c8'::uuid, 'sunrise-unit-' || spec.code),
  TIMESTAMPTZ '2026-09-15 10:00:00+05:30',
  'priya-sharma'
FROM (VALUES ('U1'), ('U2')) AS spec(code)
ON CONFLICT (tenant_id, unit_id) DO UPDATE SET taught_at = EXCLUDED.taught_at;

INSERT INTO lesson_plans (id, tenant_id, unit_id, title, planned_date)
SELECT
  uuid_generate_v5('6ba7b810-9dad-11d1-80b4-00c04fd430c8'::uuid, 'sunrise-lesson-' || spec.code || '-' || spec.n::text),
  '00000000-0000-4000-8000-00000000a501'::uuid,
  uuid_generate_v5('6ba7b810-9dad-11d1-80b4-00c04fd430c8'::uuid, 'sunrise-unit-' || spec.code),
  spec.title,
  spec.planned_date
FROM (
  VALUES
    ('U1'::text, 1::int, 'Irrational numbers'::text, DATE '2026-09-08'),
    ('U1', 2, 'Real numbers on the number line', DATE '2026-09-10'),
    ('U2', 1, 'Zeroes of a polynomial', DATE '2026-09-16')
) AS spec(code, n, title, planned_date)
ON CONFLICT (id) DO UPDATE SET title = EXCLUDED.title, planned_date = EXCLUDED.planned_date;

INSERT INTO learning_outcomes (id, tenant_id, unit_id, subject_id, grade_id, code, statement)
SELECT
  uuid_generate_v5('6ba7b810-9dad-11d1-80b4-00c04fd430c8'::uuid, 'sunrise-outcome-' || spec.code),
  '00000000-0000-4000-8000-00000000a501'::uuid,
  uuid_generate_v5('6ba7b810-9dad-11d1-80b4-00c04fd430c8'::uuid, 'sunrise-unit-' || spec.unit_code),
  '00000000-0000-4000-8000-00000000a581'::uuid,
  '00000000-0000-4000-8000-00000000a542'::uuid,
  spec.code,
  spec.statement
FROM (
  VALUES
    ('M9.1'::text, 'U1'::text, 'Represent real numbers on the number line'::text),
    ('M9.2', 'U2', 'Factorise polynomials using identities'),
    ('M9.3', 'U3', 'Plot points in the Cartesian plane')
) AS spec(code, unit_code, statement)
ON CONFLICT (id) DO UPDATE
SET statement = EXCLUDED.statement, unit_id = EXCLUDED.unit_id, updated_at = now();

INSERT INTO institution_condition_options (id, tenant_id, name, description)
SELECT
  uuid_generate_v5('6ba7b810-9dad-11d1-80b4-00c04fd430c8'::uuid, 'sunrise-condition-' || spec.name),
  '00000000-0000-4000-8000-00000000a501'::uuid,
  spec.name,
  spec.name
FROM (VALUES ('Good'), ('Fair'), ('Needs repair'), ('Unknown')) AS spec(name)
ON CONFLICT (tenant_id, name) DO NOTHING;

INSERT INTO institution_infrastructure (
  id, tenant_id, institution_id, parent_id, type, name, capacity, condition, description
)
SELECT
  spec.id,
  '00000000-0000-4000-8000-00000000a501'::uuid,
  '00000000-0000-4000-8000-00000000a551'::uuid,
  spec.parent_id,
  spec.type,
  spec.name,
  spec.capacity,
  spec.condition,
  spec.description
FROM (
  VALUES
    (uuid_generate_v5('6ba7b810-9dad-11d1-80b4-00c04fd430c8'::uuid, 'sunrise-fac-campus')::uuid, NULL::uuid, 'LAND'::text, 'Mayur Vihar campus'::text, 2400::int, 'Good'::text, NULL::text),
    (uuid_generate_v5('6ba7b810-9dad-11d1-80b4-00c04fd430c8'::uuid, 'sunrise-fac-block-a'), uuid_generate_v5('6ba7b810-9dad-11d1-80b4-00c04fd430c8'::uuid, 'sunrise-fac-campus'), 'BUILDING', 'Academic Block A', 960, 'Good', NULL),
    (uuid_generate_v5('6ba7b810-9dad-11d1-80b4-00c04fd430c8'::uuid, 'sunrise-fac-gf'), uuid_generate_v5('6ba7b810-9dad-11d1-80b4-00c04fd430c8'::uuid, 'sunrise-fac-block-a'), 'FLOOR', 'Ground floor', 480, 'Good', NULL),
    (uuid_generate_v5('6ba7b810-9dad-11d1-80b4-00c04fd430c8'::uuid, 'sunrise-fac-r101'), uuid_generate_v5('6ba7b810-9dad-11d1-80b4-00c04fd430c8'::uuid, 'sunrise-fac-gf'), 'ROOM', 'Room 101', 40, 'Good', NULL),
    (uuid_generate_v5('6ba7b810-9dad-11d1-80b4-00c04fd430c8'::uuid, 'sunrise-fac-r102'), uuid_generate_v5('6ba7b810-9dad-11d1-80b4-00c04fd430c8'::uuid, 'sunrise-fac-gf'), 'ROOM', 'Room 102', 40, 'Good', NULL),
    (uuid_generate_v5('6ba7b810-9dad-11d1-80b4-00c04fd430c8'::uuid, 'sunrise-fac-r103'), uuid_generate_v5('6ba7b810-9dad-11d1-80b4-00c04fd430c8'::uuid, 'sunrise-fac-gf'), 'ROOM', 'Room 103', 36, 'Fair', NULL),
    (uuid_generate_v5('6ba7b810-9dad-11d1-80b4-00c04fd430c8'::uuid, 'sunrise-fac-ff'), uuid_generate_v5('6ba7b810-9dad-11d1-80b4-00c04fd430c8'::uuid, 'sunrise-fac-block-a'), 'FLOOR', 'First floor', 480, 'Good', NULL),
    (uuid_generate_v5('6ba7b810-9dad-11d1-80b4-00c04fd430c8'::uuid, 'sunrise-fac-r201'), uuid_generate_v5('6ba7b810-9dad-11d1-80b4-00c04fd430c8'::uuid, 'sunrise-fac-ff'), 'ROOM', 'Room 201', 40, 'Good', NULL),
    (uuid_generate_v5('6ba7b810-9dad-11d1-80b4-00c04fd430c8'::uuid, 'sunrise-fac-r202'), uuid_generate_v5('6ba7b810-9dad-11d1-80b4-00c04fd430c8'::uuid, 'sunrise-fac-ff'), 'ROOM', 'Room 202', 40, 'Good', NULL),
    (uuid_generate_v5('6ba7b810-9dad-11d1-80b4-00c04fd430c8'::uuid, 'sunrise-fac-r204'), uuid_generate_v5('6ba7b810-9dad-11d1-80b4-00c04fd430c8'::uuid, 'sunrise-fac-ff'), 'ROOM', 'Room 204', 32, 'Needs repair', NULL),
    (uuid_generate_v5('6ba7b810-9dad-11d1-80b4-00c04fd430c8'::uuid, 'sunrise-fac-block-b'), uuid_generate_v5('6ba7b810-9dad-11d1-80b4-00c04fd430c8'::uuid, 'sunrise-fac-campus'), 'BUILDING', 'Senior Block B', 720, 'Good', NULL),
    (uuid_generate_v5('6ba7b810-9dad-11d1-80b4-00c04fd430c8'::uuid, 'sunrise-fac-labs'), uuid_generate_v5('6ba7b810-9dad-11d1-80b4-00c04fd430c8'::uuid, 'sunrise-fac-block-b'), 'FLOOR', 'Labs', 180, 'Good', NULL),
    (uuid_generate_v5('6ba7b810-9dad-11d1-80b4-00c04fd430c8'::uuid, 'sunrise-fac-phys'), uuid_generate_v5('6ba7b810-9dad-11d1-80b4-00c04fd430c8'::uuid, 'sunrise-fac-labs'), 'ROOM', 'Physics lab L1', 30, 'Good', NULL),
    (uuid_generate_v5('6ba7b810-9dad-11d1-80b4-00c04fd430c8'::uuid, 'sunrise-fac-chem'), uuid_generate_v5('6ba7b810-9dad-11d1-80b4-00c04fd430c8'::uuid, 'sunrise-fac-labs'), 'ROOM', 'Chemistry lab L2', 28, 'Needs repair', NULL),
    (uuid_generate_v5('6ba7b810-9dad-11d1-80b4-00c04fd430c8'::uuid, 'sunrise-fac-sports'), uuid_generate_v5('6ba7b810-9dad-11d1-80b4-00c04fd430c8'::uuid, 'sunrise-fac-campus'), 'BUILDING', 'Sports pavilion', 200, 'Unknown', NULL)
) AS spec(id, parent_id, type, name, capacity, condition, description)
ON CONFLICT (id) DO UPDATE
SET parent_id = EXCLUDED.parent_id,
    name = EXCLUDED.name,
    capacity = EXCLUDED.capacity,
    condition = EXCLUDED.condition,
    description = EXCLUDED.description,
    updated_at = now();

INSERT INTO institution_repair_requests (
  id, tenant_id, institution_id, infrastructure_id, summary, status, created_at
)
VALUES (
  uuid_generate_v5('6ba7b810-9dad-11d1-80b4-00c04fd430c8'::uuid, 'sunrise-repair-r204'),
  '00000000-0000-4000-8000-00000000a501',
  '00000000-0000-4000-8000-00000000a551',
  uuid_generate_v5('6ba7b810-9dad-11d1-80b4-00c04fd430c8'::uuid, 'sunrise-fac-r204'),
  'Ceiling tiles loose above the rear row',
  'open',
  TIMESTAMPTZ '2026-09-22 15:20:00+05:30'
)
ON CONFLICT (id) DO NOTHING;

-- Merit scholarship for Aarav Mehta. Document bytes are the canonical
-- placeholder PDF (sha256 7856c8e9…); write them with
--   node db/seeds/write-sunrise-scholarship-placeholders.mjs
-- Metadata only is stored here so the seed stays free of large binaries.
INSERT INTO scholarship_programs (
  id, tenant_id, name, description, application_start_date, application_end_date,
  total_slots, used_slots, amount_per_recipient, amount_per_recipient_cents, currency,
  disbursement_frequency, eligibility, status
)
VALUES (
  '00000000-0000-4000-8000-00000000a5e1',
  '00000000-0000-4000-8000-00000000a501',
  'Sunrise Merit Award',
  'Need and merit support for Grade 9. Required files: income certificate, marksheet, ID proof.',
  DATE '2026-01-01',
  DATE '2026-12-31',
  40,
  1,
  25000,
  2500000,
  'INR',
  'one_time',
  '{"minGPA":3.0,"requiredDocuments":["income_certificate","marksheet","id_proof"]}'::jsonb,
  'open'
)
ON CONFLICT (id) DO NOTHING;

INSERT INTO scholarship_applications (
  id, tenant_id, program_id, applicant_id, institution_id, status,
  academic_records, financial_info, documents, personal_statement, gender, submitted_at
)
VALUES (
  '00000000-0000-4000-8000-00000000a5e2',
  '00000000-0000-4000-8000-00000000a501',
  '00000000-0000-4000-8000-00000000a5e1',
  '00000000-0000-4000-8000-00000000a5b1',
  '00000000-0000-4000-8000-00000000a551',
  'under_review',
  '[{"institutionName":"Sunrise Public School – Mayur Vihar","educationLevel":"secondary","gpa":3.6,"yearCompleted":2026}]'::jsonb,
  '{"familyIncome":180000,"numberOfDependents":2,"employmentStatus":"student"}'::jsonb,
  '[]'::jsonb,
  'Aarav is applying for the Sunrise Merit Award.',
  'male',
  TIMESTAMPTZ '2026-09-01 10:00:00+05:30'
)
ON CONFLICT (id) DO NOTHING;

INSERT INTO scholarship_application_documents (
  id, tenant_id, application_id, document_type, object_key, original_filename,
  mime_type, size_bytes, sha256, uploaded_by, uploaded_at, verification_status,
  reviewer_id, rejection_reason, reviewed_at
)
VALUES
  (
    '00000000-0000-4000-8000-00000000a5e3',
    '00000000-0000-4000-8000-00000000a501',
    '00000000-0000-4000-8000-00000000a5e2',
    'income_certificate',
    'scholarships/00000000-0000-4000-8000-00000000a5e2/documents/00000000-0000-4000-8000-00000000a5e3',
    'income-certificate.pdf',
    'application/pdf',
    118,
    '7856c8e9ef203bbcac0d98630035fd1ced46f1bdd446c940d6411e183f6073ec',
    'parent-mehta',
    TIMESTAMPTZ '2026-09-01 10:05:00+05:30',
    'PENDING',
    NULL,
    NULL,
    NULL
  ),
  (
    '00000000-0000-4000-8000-00000000a5e4',
    '00000000-0000-4000-8000-00000000a501',
    '00000000-0000-4000-8000-00000000a5e2',
    'marksheet',
    'scholarships/00000000-0000-4000-8000-00000000a5e2/documents/00000000-0000-4000-8000-00000000a5e4',
    'marksheet.pdf',
    'application/pdf',
    118,
    '7856c8e9ef203bbcac0d98630035fd1ced46f1bdd446c940d6411e183f6073ec',
    'parent-mehta',
    TIMESTAMPTZ '2026-09-01 10:06:00+05:30',
    'VERIFIED',
    'priya-sharma',
    NULL,
    TIMESTAMPTZ '2026-09-02 09:00:00+05:30'
  ),
  (
    '00000000-0000-4000-8000-00000000a5e5',
    '00000000-0000-4000-8000-00000000a501',
    '00000000-0000-4000-8000-00000000a5e2',
    'id_proof',
    'scholarships/00000000-0000-4000-8000-00000000a5e2/documents/00000000-0000-4000-8000-00000000a5e5',
    'id-proof.pdf',
    'application/pdf',
    118,
    '7856c8e9ef203bbcac0d98630035fd1ced46f1bdd446c940d6411e183f6073ec',
    'parent-mehta',
    TIMESTAMPTZ '2026-09-01 10:07:00+05:30',
    'REJECTED',
    'priya-sharma',
    'The scan is unreadable. Upload a clearer copy of the school ID.',
    TIMESTAMPTZ '2026-09-02 09:05:00+05:30'
  )
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
  n_named int;
  n_areas int;
  n_docs int;
  pct int;
BEGIN
  SELECT count(*) INTO n_institutions
    FROM institutions
   WHERE tenant_id = tid AND deleted_at IS NULL
     AND code IN ('07040100417', '07040100522', '07040100618', '07040200731', '07040100844');
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
  SELECT count(*) INTO n_named
    FROM students
   WHERE tenant_id = tid AND id = '00000000-0000-4000-8000-00000000a5b1' AND first_name = 'Aarav';
  SELECT count(*) INTO n_areas
    FROM geographic_areas
   WHERE tenant_id = tid AND deleted_at IS NULL
     AND code IN ('DL-EAST', 'DL-NORTH', 'DL-SOUTH');

  SELECT count(*) INTO n_docs
    FROM scholarship_application_documents
   WHERE tenant_id = tid AND deleted_at IS NULL;

  IF n_institutions < 5 OR n_areas < 3 OR n_classes < 6 OR n_sections < 3
     OR n_students < 3615 OR n_staff < 245 OR n_named < 1
     OR n_plans < 3 OR n_invoices < 3 OR n_open < 1 OR n_paid < 1
     OR n_consents < 2 OR n_pending < 1 OR n_decided < 1 OR n_docs < 3 THEN
    RAISE EXCEPTION
      'sunrise demo seed incomplete: institutions=% areas=% classes=% sections=% students=% staff=% named=% plans=% invoices=% open=% paid=% consents=% pending=% decided=% docs=%',
      n_institutions, n_areas, n_classes, n_sections, n_students, n_staff, n_named, n_plans, n_invoices, n_open, n_paid, n_consents, n_pending, n_decided, n_docs;
  END IF;

  FOR pct IN
    SELECT ROUND(100.0 * COUNT(*) FILTER (WHERE status IN ('PRESENT', 'LATE')) / COUNT(*))::int
      FROM student_attendance
     WHERE tenant_id = tid AND date = CURRENT_DATE
     GROUP BY institution_id
     ORDER BY 1
  LOOP
    IF pct NOT IN (76, 88, 91, 94) THEN
      RAISE EXCEPTION 'sunrise attendance percent % is outside 94/91/88/76', pct;
    END IF;
  END LOOP;

  IF (
    SELECT COUNT(DISTINCT institution_id)
      FROM student_attendance
     WHERE tenant_id = tid AND date = CURRENT_DATE
  ) <> 4 THEN
    RAISE EXCEPTION 'sunrise attendance today must cover exactly 4 active schools';
  END IF;

  RAISE NOTICE
    'sunrise demo counts tenant=% institutions=% areas=% classes=% sections=% students=% staff=% fee_plans=% fee_invoices=% (open=% paid=%) consents=% (pending=% decided=%)',
    tid, n_institutions, n_areas, n_classes, n_sections, n_students, n_staff, n_plans, n_invoices, n_open, n_paid, n_consents, n_pending, n_decided;
END $$;

COMMIT;
