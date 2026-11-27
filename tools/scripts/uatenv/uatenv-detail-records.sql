-- UAT-only detail records for the Sunrise demo tenant (UATENV-D17).
--
-- The UAT render pass opens every dynamic detail route with one real record id
-- per segment. The Sunrise demo seed (db/seeds/006_sunrise_public_school_demo.sql)
-- has no row for nine of them, so 15 routes were SKIPPED "no fixture id". This
-- file adds one record each, in the table the gateway reads for that route:
--
--   route                                   table (gateway read path)
--   /admissions/[id]                        admission_applications (registration pipeline)
--   /assessments/schemes/[id]/edit          grading_schemes (assessment, Prisma)
--   /communication/circulars/[id]           comms_circulars (communication circulars)
--   /examinations/[id] (+ candidates,       examinations (examination, Prisma)
--     documents, ops, results)
--   /library/[id]                           library_items
--   /lms/assignments/[id]                   lms_assignments
--   /parent/messages/[threadId]             parent_message_threads + parent_messages
--                                           (visible to the guardian linked to the student)
--   /transport/routes/[id]/stops            transport_routes + transport_stops
--   /workflows/definitions/[id]             workflow_ui_definitions (gateway workflow UI store)
--
-- The two other skipped routes need no row: report-card jobs already exist in
-- board_export_jobs (job_type REPORT_CARD, Sunrise seed), and /reports/[id]
-- opens a built-in catalogue template (packages/backend/report/src/catalogue.ts).
--
-- Never a production seed. This file is not under db/ and is applied only by
-- tools/scripts/uatenv/uatenv-seed-detail-records.sh, which sets the
-- transaction-local guard proctira.allow_uat_seed=on for one psql call. Without
-- that guard the first statement raises and nothing is written
-- (uatenv-contract.test.mjs pins both).
--
-- Fixed ids 00000000-0000-4000-8000-00000d17NNNN mark every row as UAT D17 data.
-- Idempotent: every insert is ON CONFLICT DO NOTHING (a tester-created row with
-- the same name, code, ISBN or tracking number wins and this row is skipped).
-- Applied as the migrator (proctira, NOSUPERUSER NOBYPASSRLS) with app.tenant_id
-- bound to Sunrise, so RLS checks every row.
\set ON_ERROR_STOP on
BEGIN;
DO $$
BEGIN
  IF current_setting('proctira.allow_uat_seed', true) IS DISTINCT FROM 'on' THEN
    RAISE EXCEPTION 'UAT detail records are guarded: apply them with tools/scripts/uatenv/uatenv-seed-detail-records.sh (sets proctira.allow_uat_seed=on)'
      USING ERRCODE = 'insufficient_privilege';
  END IF;
END $$;
DO $$ BEGIN
  PERFORM set_app_tenant_id('00000000-0000-4000-8000-00000000a501');
  IF NOT EXISTS (
    SELECT 1 FROM institutions
     WHERE tenant_id = '00000000-0000-4000-8000-00000000a501'
       AND id = '00000000-0000-4000-8000-00000000a551'
  ) THEN
    RAISE EXCEPTION 'Sunrise demo tenant is not seeded: apply db/seeds/006_sunrise_public_school_demo.sql first';
  END IF;
END $$;
-- Admissions: one application under review (Grade 8, AY 2026-27, Mayur Vihar).
INSERT INTO admission_applications (
  id, tenant_id, tracking_number, institution_id, institution_name, status,
  first_name, last_name, date_of_birth, gender, guardian_name, guardian_phone,
  guardian_email, custom_fields, documents, preferred_language, remarks,
  submitted_at, updated_at, academic_period_id, grade_id
)
VALUES (
  '00000000-0000-4000-8000-00000d170001',
  '00000000-0000-4000-8000-00000000a501',
  'UAT-D17-0001',
  '00000000-0000-4000-8000-00000000a551',
  'Sunrise Public School – Mayur Vihar',
  'under_review',
  'Kavya',
  'Iyer',
  DATE '2013-07-19',
  'female',
  'Meera Iyer',
  '+91 90000 00171',
  'meera.iyer@example.invalid',
  '{}'::jsonb,
  '[]'::jsonb,
  'en',
  'UAT demo application (D17).',
  TIMESTAMPTZ '2026-11-02 10:30:00+05:30',
  TIMESTAMPTZ '2026-11-02 10:30:00+05:30',
  '00000000-0000-4000-8000-00000000a531',
  '00000000-0000-4000-8000-00000000a541'
)
ON CONFLICT DO NOTHING;
-- Assessment: a letter grading scheme (0-100).
INSERT INTO grading_schemes (id, tenant_id, name, type, min_value, max_value, thresholds, created_at, updated_at)
VALUES (
  '00000000-0000-4000-8000-00000d170002',
  '00000000-0000-4000-8000-00000000a501',
  'Sunrise Letter Scale A-E',
  'letter',
  0,
  100,
  '[{"grade":"A","minScore":90,"maxScore":100},{"grade":"B","minScore":75,"maxScore":89.99},{"grade":"C","minScore":60,"maxScore":74.99},{"grade":"D","minScore":33,"maxScore":59.99},{"grade":"E","minScore":0,"maxScore":32.99}]'::jsonb,
  now(),
  now()
)
ON CONFLICT DO NOTHING;
-- Communication: a draft circular to everyone (no delivery rows are created).
INSERT INTO comms_circulars (
  id, tenant_id, title, body, audience_type, audience_json, requires_ack, channels,
  status, created_by, created_at, updated_at
)
VALUES (
  '00000000-0000-4000-8000-00000d170003',
  '00000000-0000-4000-8000-00000000a501',
  'Parent-teacher meeting, Term 1',
  'The Term 1 parent-teacher meeting is on Saturday 12 December 2026, 09:00-12:00, in each class room.',
  'all',
  '{}'::jsonb,
  true,
  ARRAY['in_app']::text[],
  'draft',
  NULL,
  now(),
  now()
)
ON CONFLICT DO NOTHING;
-- Examinations: Term 1 examination with one subject, centre, session and scheme.
INSERT INTO examinations (
  id, tenant_id, name, code, description, academic_period_id, start_date, end_date,
  status, subjects, centers, sessions, grading_schemes, created_at, updated_at
)
VALUES (
  '00000000-0000-4000-8000-00000d170004',
  '00000000-0000-4000-8000-00000000a501',
  'Term 1 Examination 2026',
  'UAT-T1-2026',
  'UAT demo examination (D17).',
  '00000000-0000-4000-8000-00000000a531',
  DATE '2026-12-14',
  DATE '2026-12-18',
  'SCHEDULED',
  '[{"id":"00000000-0000-4000-8000-00000d170041","name":"Mathematics","code":"MATH","maxScore":100,"gradingSchemeId":"00000000-0000-4000-8000-00000d170043"}]'::jsonb,
  '[{"id":"00000000-0000-4000-8000-00000d170042","name":"Mayur Vihar main hall","code":"MV-HALL","institutionId":"00000000-0000-4000-8000-00000000a551","capacity":400}]'::jsonb,
  '[{"id":"00000000-0000-4000-8000-00000d170044","subjectId":"00000000-0000-4000-8000-00000d170041","date":"2026-12-14","startTime":"09:00","endTime":"12:00","centerId":"00000000-0000-4000-8000-00000d170042"}]'::jsonb,
  '[{"id":"00000000-0000-4000-8000-00000d170043","name":"Marks out of 100","minScore":0,"maxScore":100,"passThreshold":33,"thresholds":[{"grade":"Pass","minScore":33,"maxScore":100},{"grade":"Fail","minScore":0,"maxScore":32.99}]}]'::jsonb,
  now(),
  now()
)
ON CONFLICT DO NOTHING;
-- Library: one catalogue item with three copies on the shelf.
INSERT INTO library_items (
  id, tenant_id, isbn, title, author, copies, available, barcode, accession_no,
  publisher, published_year, created_at, updated_at
)
VALUES (
  '00000000-0000-4000-8000-00000d170005',
  '00000000-0000-4000-8000-00000000a501',
  '9788173711466',
  'Wings of Fire',
  'A. P. J. Abdul Kalam',
  3,
  3,
  'UAT-D17-LIB-0001',
  'UAT-D17-ACC-0001',
  'Universities Press',
  1999,
  now(),
  now()
)
ON CONFLICT DO NOTHING;
-- LMS: a published school assignment for Class 9-B Mathematics (the portal student's section).
INSERT INTO lms_assignments (
  id, tenant_id, scope, institution_id, kind, title, description, subject, grade_level,
  section_id, skill_ids, max_score, due_at, allow_late, status, published_at,
  academic_period_id, created_at, updated_at
)
VALUES (
  '00000000-0000-4000-8000-00000d170006',
  '00000000-0000-4000-8000-00000000a501',
  'school',
  '00000000-0000-4000-8000-00000000a551',
  'assignment',
  'Linear equations practice set',
  'Solve the ten problems on page 42 and show your working.',
  'Mathematics',
  'Grade 9',
  '00000000-0000-4000-8000-00000000a572',
  '[]'::jsonb,
  20,
  TIMESTAMPTZ '2026-12-20 17:00:00+05:30',
  true,
  'published',
  TIMESTAMPTZ '2026-11-20 09:00:00+05:30',
  '00000000-0000-4000-8000-00000000a531',
  now(),
  now()
)
ON CONFLICT DO NOTHING;
-- Parent portal: a staff-started thread about the portal student (Aarav Mehta), one message.
INSERT INTO parent_message_threads (id, tenant_id, student_id, subject, created_by, status, created_at, updated_at)
VALUES (
  '00000000-0000-4000-8000-00000d170007',
  '00000000-0000-4000-8000-00000000a501',
  '00000000-0000-4000-8000-00000000a5b1',
  'Mathematics practice set',
  '00000000-0000-4000-8000-00000000a591',
  'open',
  TIMESTAMPTZ '2026-11-20 09:15:00+05:30',
  TIMESTAMPTZ '2026-11-20 09:15:00+05:30'
)
ON CONFLICT DO NOTHING;
INSERT INTO parent_messages (id, thread_id, tenant_id, sender_user_id, sender_role, body, created_at)
VALUES (
  '00000000-0000-4000-8000-00000d170071',
  '00000000-0000-4000-8000-00000d170007',
  '00000000-0000-4000-8000-00000000a501',
  '00000000-0000-4000-8000-00000000a591',
  'staff',
  'Aarav has a new practice set due on 20 December. Please make sure he brings his workbook.',
  TIMESTAMPTZ '2026-11-20 09:15:00+05:30'
)
ON CONFLICT DO NOTHING;
-- Transport: one active route with three stops.
INSERT INTO transport_routes (
  id, tenant_id, name, description, status, start_location, end_location, distance_km,
  estimated_duration_minutes, operating_days, departure_time, return_time, institution_id,
  created_at, updated_at
)
VALUES (
  '00000000-0000-4000-8000-00000d170008',
  '00000000-0000-4000-8000-00000000a501',
  'Route 7 – Mayur Vihar Phase 1',
  'UAT demo route (D17).',
  'active',
  'Mayur Vihar Phase 1 Metro',
  'Sunrise Public School – Mayur Vihar',
  9.5,
  35,
  ARRAY['monday', 'tuesday', 'wednesday', 'thursday', 'friday', 'saturday']::text[],
  '07:00',
  '13:45',
  '00000000-0000-4000-8000-00000000a551',
  now(),
  now()
)
ON CONFLICT DO NOTHING;
INSERT INTO transport_stops (id, tenant_id, route_id, name, latitude, longitude, stop_order, pickup_time, dropoff_time, created_at, updated_at)
SELECT s.id::uuid, '00000000-0000-4000-8000-00000000a501', '00000000-0000-4000-8000-00000d170008',
       s.name, s.lat, s.lng, s.ord, s.pickup, s.dropoff, now(), now()
  FROM (VALUES
    ('00000000-0000-4000-8000-00000d170081', 'Mayur Vihar Phase 1 Metro', 28.6044, 77.2895, 1, '07:00', '13:45'),
    ('00000000-0000-4000-8000-00000d170082', 'Pocket C market', 28.6081, 77.2940, 2, '07:12', '13:33'),
    ('00000000-0000-4000-8000-00000d170083', 'Sunrise Public School gate', 28.6072, 77.2965, 3, '07:30', '13:30')
  ) AS s(id, name, lat, lng, ord, pickup, dropoff)
 WHERE EXISTS (SELECT 1 FROM transport_routes r WHERE r.id = '00000000-0000-4000-8000-00000d170008')
ON CONFLICT DO NOTHING;
-- Workflows: a two-step definition in the gateway workflow UI store.
INSERT INTO workflow_ui_definitions (id, tenant_id, name, module, version, steps, active, updated_at)
VALUES (
  '00000000-0000-4000-8000-00000d170009',
  '00000000-0000-4000-8000-00000000a501',
  'Fee concession approval',
  'fees',
  1,
  '[{"id":"step-bursar","order":1,"name":"Bursar review","approverRole":"BURSAR"},{"id":"step-principal","order":2,"name":"Principal approval","approverRole":"PRINCIPAL"}]'::jsonb,
  true,
  now()
)
ON CONFLICT DO NOTHING;
-- Every detail route now has at least one Sunrise record to open.
DO $$
DECLARE
  tid CONSTANT uuid := '00000000-0000-4000-8000-00000000a501';
  missing text[] := ARRAY[]::text[];
BEGIN
  IF NOT EXISTS (SELECT 1 FROM admission_applications WHERE tenant_id = tid) THEN missing := missing || 'admission_applications'; END IF;
  IF NOT EXISTS (SELECT 1 FROM grading_schemes WHERE tenant_id = tid) THEN missing := missing || 'grading_schemes'; END IF;
  IF NOT EXISTS (SELECT 1 FROM comms_circulars WHERE tenant_id = tid) THEN missing := missing || 'comms_circulars'; END IF;
  IF NOT EXISTS (SELECT 1 FROM examinations WHERE tenant_id = tid) THEN missing := missing || 'examinations'; END IF;
  IF NOT EXISTS (SELECT 1 FROM library_items WHERE tenant_id = tid) THEN missing := missing || 'library_items'; END IF;
  IF NOT EXISTS (SELECT 1 FROM lms_assignments WHERE tenant_id = tid) THEN missing := missing || 'lms_assignments'; END IF;
  IF NOT EXISTS (SELECT 1 FROM parent_message_threads WHERE tenant_id = tid) THEN missing := missing || 'parent_message_threads'; END IF;
  IF NOT EXISTS (SELECT 1 FROM transport_routes WHERE tenant_id = tid) THEN missing := missing || 'transport_routes'; END IF;
  IF NOT EXISTS (SELECT 1 FROM workflow_ui_definitions WHERE tenant_id = tid) THEN missing := missing || 'workflow_ui_definitions'; END IF;
  IF NOT EXISTS (SELECT 1 FROM board_export_jobs WHERE tenant_id = tid AND job_type = 'REPORT_CARD') THEN missing := missing || 'board_export_jobs(REPORT_CARD)'; END IF;
  IF cardinality(missing) > 0 THEN
    RAISE EXCEPTION 'UAT detail records missing for: %', array_to_string(missing, ', ');
  END IF;
  RAISE NOTICE 'uat detail records: d17 rows=%',
    (SELECT count(*) FROM admission_applications WHERE id = '00000000-0000-4000-8000-00000d170001')
    + (SELECT count(*) FROM grading_schemes WHERE id = '00000000-0000-4000-8000-00000d170002')
    + (SELECT count(*) FROM comms_circulars WHERE id = '00000000-0000-4000-8000-00000d170003')
    + (SELECT count(*) FROM examinations WHERE id = '00000000-0000-4000-8000-00000d170004')
    + (SELECT count(*) FROM library_items WHERE id = '00000000-0000-4000-8000-00000d170005')
    + (SELECT count(*) FROM lms_assignments WHERE id = '00000000-0000-4000-8000-00000d170006')
    + (SELECT count(*) FROM parent_message_threads WHERE id = '00000000-0000-4000-8000-00000d170007')
    + (SELECT count(*) FROM transport_routes WHERE id = '00000000-0000-4000-8000-00000d170008')
    + (SELECT count(*) FROM workflow_ui_definitions WHERE id = '00000000-0000-4000-8000-00000d170009');
END $$;
COMMIT;
