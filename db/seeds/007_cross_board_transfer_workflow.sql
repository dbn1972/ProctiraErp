-- Sunrise cross-board transfer fixtures.
-- Tenant 00000000-0000-4000-8000-00000000a501 is CBSE (board a521, school a551).
-- Adds an ICSE school and a Maharashtra state-board school, equivalency rules,
-- one SUBMITTED transfer (Aarav Mehta → ICSE) and one APPROVED transfer (Diya Sharma → state).
-- Idempotent. Does not delete students. Run after 006 and migration 104:
--   psql "$DATABASE_URL" -v ON_ERROR_STOP=1 -f db/seeds/007_cross_board_transfer_workflow.sql

\set ON_ERROR_STOP on

BEGIN;

DO $$ BEGIN
  PERFORM set_config('app.platform_admin', '1', true);
  PERFORM set_app_tenant_id('00000000-0000-4000-8000-00000000a501');
END $$;

INSERT INTO boards (id, tenant_id, name, code, type, status)
VALUES
  ('00000000-0000-4000-8000-00000000a7b1', '00000000-0000-4000-8000-00000000a501', 'Council for the Indian School Certificate Examinations', 'ICSE', 'PRIVATE', 'active'),
  ('00000000-0000-4000-8000-00000000a7b2', '00000000-0000-4000-8000-00000000a501', 'Maharashtra State Board', 'MH-STATE', 'STATE', 'active')
ON CONFLICT (id) DO NOTHING;

INSERT INTO institutions (
  id, tenant_id, name, code, board_id, area_id, type, sector, ownership, status, custom_data
)
VALUES
  (
    '00000000-0000-4000-8000-00000000a7c1',
    '00000000-0000-4000-8000-00000000a501',
    'Proctira Academy Bengaluru',
    'ICSE-BLR-SPS',
    '00000000-0000-4000-8000-00000000a7b1',
    '00000000-0000-4000-8000-00000000a511',
    'school', 'private', 'private', 'active',
    '{"boardCode":"ICSE","demo":"cross-board-transfer"}'::jsonb
  ),
  (
    '00000000-0000-4000-8000-00000000a7c2',
    '00000000-0000-4000-8000-00000000a501',
    'Proctira Vidyalaya Pune',
    'MH-PUN-SPS',
    '00000000-0000-4000-8000-00000000a7b2',
    '00000000-0000-4000-8000-00000000a511',
    'school', 'private', 'private', 'active',
    '{"boardCode":"MH-STATE","demo":"cross-board-transfer"}'::jsonb
  )
ON CONFLICT (id) DO NOTHING;

INSERT INTO classes (id, tenant_id, institution_id, grade_id, academic_period_id, name, capacity)
VALUES
  ('00000000-0000-4000-8000-00000000a7d1', '00000000-0000-4000-8000-00000000a501', '00000000-0000-4000-8000-00000000a7c1', '00000000-0000-4000-8000-00000000a542', '00000000-0000-4000-8000-00000000a531', 'ICSE 9-A', 40),
  ('00000000-0000-4000-8000-00000000a7d2', '00000000-0000-4000-8000-00000000a501', '00000000-0000-4000-8000-00000000a7c2', '00000000-0000-4000-8000-00000000a542', '00000000-0000-4000-8000-00000000a531', 'State 9-A', 40)
ON CONFLICT (id) DO NOTHING;

INSERT INTO grade_equivalency_rules (
  id, tenant_id, source_board_id, target_board_id, source_grade_code, target_grade_code,
  source_subject, target_subject, source_marks_max, target_marks_max, credit_factor, mapping_status, notes
)
VALUES
  ('00000000-0000-4000-8000-00000000a7f1', '00000000-0000-4000-8000-00000000a501', '00000000-0000-4000-8000-00000000a521', '00000000-0000-4000-8000-00000000a7b1', 'G9', 'G9', 'Mathematics', 'Mathematics', 100, 100, 1, 'mapped', 'CBSE 100 to ICSE 100 is identity'),
  ('00000000-0000-4000-8000-00000000a7f2', '00000000-0000-4000-8000-00000000a501', '00000000-0000-4000-8000-00000000a521', '00000000-0000-4000-8000-00000000a7b1', 'G9', 'G9', 'Social Science', 'History and Civics', 100, 100, 1, 'bridge', 'Bridge exam required'),
  ('00000000-0000-4000-8000-00000000a7f3', '00000000-0000-4000-8000-00000000a501', '00000000-0000-4000-8000-00000000a521', '00000000-0000-4000-8000-00000000a7b2', 'G9', 'G9', 'Science', 'Science', 100, 80, 1, 'mapped', '75 CBSE marks become 60 on the state 80-mark internal')
ON CONFLICT (id) DO NOTHING;

INSERT INTO transfer_records (
  id, tenant_id, student_id, source_institution_id, source_enrollment_id,
  destination_institution_id, destination_enrollment_id, destination_grade_id,
  destination_class_id, academic_period_id, transfer_date, reason, workflow_status, requested_by
)
VALUES
  (
    '00000000-0000-4000-8000-00000000a7e1',
    '00000000-0000-4000-8000-00000000a501',
    '00000000-0000-4000-8000-00000000a5b1',
    '00000000-0000-4000-8000-00000000a551',
    '00000000-0000-4000-8000-00000000a5c1',
    '00000000-0000-4000-8000-00000000a7c1',
    NULL,
    '00000000-0000-4000-8000-00000000a542',
    '00000000-0000-4000-8000-00000000a7d1',
    '00000000-0000-4000-8000-00000000a531',
    DATE '2026-09-01',
    'Family moved from Mayur Vihar (CBSE) to an ICSE school',
    'SUBMITTED',
    'sunrise-registrar'
  ),
  (
    '00000000-0000-4000-8000-00000000a7e2',
    '00000000-0000-4000-8000-00000000a501',
    '00000000-0000-4000-8000-00000000a5b2',
    '00000000-0000-4000-8000-00000000a551',
    '00000000-0000-4000-8000-00000000a5c2',
    '00000000-0000-4000-8000-00000000a7c2',
    NULL,
    '00000000-0000-4000-8000-00000000a542',
    '00000000-0000-4000-8000-00000000a7d2',
    '00000000-0000-4000-8000-00000000a531',
    DATE '2026-08-20',
    'Approved move onto the Maharashtra state board',
    'APPROVED',
    'sunrise-registrar'
  )
ON CONFLICT (id) DO NOTHING;

COMMIT;
