-- WS2 master schedule demo seed for cert tenant `proctira-multiboard-cert`.
-- Seeds rooms, bell schedule + periods, sections, meetings, enrollments on CBSE-DEL-01.
-- Idempotent: deletes prior rows tagged with seed marker metadata / known codes.

\set ON_ERROR_STOP on

DO $$
DECLARE
  tid UUID;
  inst_id UUID;
  period_id UUID;
  grade_id UUID;
  staff1 UUID;
  staff2 UUID;
  student1 UUID;
  student2 UUID;
  student3 UUID;
  room1 UUID := 'a1000001-0001-4000-8000-000000000001';
  room2 UUID := 'a1000001-0001-4000-8000-000000000002';
  room3 UUID := 'a1000001-0001-4000-8000-000000000003';
  bell_id UUID := 'a2000001-0001-4000-8000-000000000001';
  bp1 UUID := 'a2000001-0001-4000-8000-000000000011';
  bp2 UUID := 'a2000001-0001-4000-8000-000000000012';
  sec1 UUID := 'a3000001-0001-4000-8000-000000000001';
  sec2 UUID := 'a3000001-0001-4000-8000-000000000002';
  meet1 UUID := 'a4000001-0001-4000-8000-000000000001';
  meet2 UUID := 'a4000001-0001-4000-8000-000000000002';
  meet3 UUID := 'a4000001-0001-4000-8000-000000000003';
BEGIN
  SELECT id INTO tid FROM tenants WHERE slug = 'proctira-multiboard-cert' AND deleted_at IS NULL;
  IF tid IS NULL THEN
    RAISE NOTICE 'Tenant proctira-multiboard-cert not found — skipping master schedule seed';
    RETURN;
  END IF;

  SELECT id INTO inst_id FROM institutions
   WHERE tenant_id = tid AND code = 'CBSE-DEL-01' AND deleted_at IS NULL;
  IF inst_id IS NULL THEN
    RAISE EXCEPTION 'Institution CBSE-DEL-01 not found on cert tenant';
  END IF;

  SELECT id INTO period_id FROM academic_periods
   WHERE tenant_id = tid AND deleted_at IS NULL
   ORDER BY created_at ASC LIMIT 1;
  IF period_id IS NULL THEN
    RAISE EXCEPTION 'No academic period on cert tenant';
  END IF;

  SELECT id INTO grade_id FROM grades
   WHERE tenant_id = tid AND deleted_at IS NULL
   ORDER BY "order" ASC LIMIT 1;

  SELECT id INTO staff1 FROM staff
   WHERE tenant_id = tid AND last_name = 'CBSE-DEL-01-1' AND deleted_at IS NULL LIMIT 1;
  SELECT id INTO staff2 FROM staff
   WHERE tenant_id = tid AND last_name = 'CBSE-DEL-01-2' AND deleted_at IS NULL LIMIT 1;

  SELECT id INTO student1 FROM students WHERE tenant_id = tid AND deleted_at IS NULL ORDER BY id LIMIT 1 OFFSET 0;
  SELECT id INTO student2 FROM students WHERE tenant_id = tid AND deleted_at IS NULL ORDER BY id LIMIT 1 OFFSET 1;
  SELECT id INTO student3 FROM students WHERE tenant_id = tid AND deleted_at IS NULL ORDER BY id LIMIT 1 OFFSET 2;

  IF staff1 IS NULL OR staff2 IS NULL OR student1 IS NULL OR student2 IS NULL OR student3 IS NULL THEN
    RAISE EXCEPTION 'Missing staff/students for CBSE-DEL-01 seed';
  END IF;
  IF student1 = student2 OR student1 = student3 OR student2 = student3 THEN
    RAISE EXCEPTION 'Seed student picks were not distinct';
  END IF;
  -- Tear down prior WS2 demo rows (by fixed ids + seed marker)
  DELETE FROM section_enrollments
   WHERE tenant_id = tid
     AND (section_id IN (sec1, sec2)
          OR section_id IN (
            SELECT id FROM sections
             WHERE tenant_id = tid
               AND metadata->>'seed' = '004_sis_master_schedule_demo'
          ));
  DELETE FROM substitutions
   WHERE tenant_id = tid
     AND section_meeting_id IN (
       SELECT id FROM section_meetings WHERE tenant_id = tid AND id IN (meet1, meet2, meet3)
     );
  DELETE FROM section_meetings WHERE tenant_id = tid AND id IN (meet1, meet2, meet3);
  DELETE FROM sections
   WHERE tenant_id = tid
     AND (id IN (sec1, sec2) OR metadata->>'seed' = '004_sis_master_schedule_demo');
  DELETE FROM bell_periods WHERE tenant_id = tid AND id IN (bp1, bp2);
  DELETE FROM bell_schedules
   WHERE tenant_id = tid
     AND (id = bell_id OR metadata->>'seed' = '004_sis_master_schedule_demo');
  DELETE FROM rooms
   WHERE tenant_id = tid
     AND (id IN (room1, room2, room3) OR metadata->>'seed' = '004_sis_master_schedule_demo');

  INSERT INTO rooms (id, tenant_id, institution_id, code, name, capacity, room_type, status, metadata)
  VALUES
    (room1, tid, inst_id, 'R101', 'Classroom 101', 40, 'CLASSROOM', 'active',
      '{"seed":"004_sis_master_schedule_demo"}'::jsonb),
    (room2, tid, inst_id, 'R102', 'Classroom 102', 40, 'CLASSROOM', 'active',
      '{"seed":"004_sis_master_schedule_demo"}'::jsonb),
    (room3, tid, inst_id, 'LAB1', 'Science Lab 1', 30, 'LAB', 'active',
      '{"seed":"004_sis_master_schedule_demo"}'::jsonb);

  INSERT INTO bell_schedules (
    id, tenant_id, institution_id, academic_period_id, code, name, day_pattern, status, metadata
  ) VALUES (
    bell_id, tid, inst_id, period_id, 'STD-DAY', 'Standard Day',
    '[1,2,3,4,5]'::jsonb, 'active',
    '{"seed":"004_sis_master_schedule_demo"}'::jsonb
  );

  INSERT INTO bell_periods (
    id, tenant_id, bell_schedule_id, code, name, period_order, start_time, end_time
  ) VALUES
    (bp1, tid, bell_id, 'P1', 'Period 1', 1, '08:00', '08:45'),
    (bp2, tid, bell_id, 'P2', 'Period 2', 2, '08:50', '09:35');

  INSERT INTO sections (
    id, tenant_id, institution_id, academic_period_id, grade_id, code, name,
    primary_teacher_id, default_room_id, capacity, status, published_at, metadata
  ) VALUES
    (sec1, tid, inst_id, period_id, grade_id, 'G6A-MATH', 'Grade 6A Mathematics',
      staff1, room1, 40, 'PUBLISHED', NOW(),
      '{"seed":"004_sis_master_schedule_demo"}'::jsonb),
    (sec2, tid, inst_id, period_id, grade_id, 'G6A-SCI', 'Grade 6A Science',
      staff2, room3, 40, 'DRAFT', NULL,
      '{"seed":"004_sis_master_schedule_demo"}'::jsonb);

  INSERT INTO section_meetings (
    id, tenant_id, section_id, bell_period_id, day_of_week, room_id, teacher_staff_id, status
  ) VALUES
    (meet1, tid, sec1, bp1, 1, room1, staff1, 'active'),
    (meet2, tid, sec1, bp2, 3, room1, staff1, 'active'),
    (meet3, tid, sec2, bp1, 2, room3, staff2, 'active');

  INSERT INTO section_enrollments (id, tenant_id, section_id, student_id, status, enrolled_at)
  VALUES (uuid_generate_v4(), tid, sec1, student1, 'ENROLLED', CURRENT_DATE);
  INSERT INTO section_enrollments (id, tenant_id, section_id, student_id, status, enrolled_at)
  VALUES (uuid_generate_v4(), tid, sec1, student2, 'ENROLLED', CURRENT_DATE);
  INSERT INTO section_enrollments (id, tenant_id, section_id, student_id, status, enrolled_at)
  VALUES (uuid_generate_v4(), tid, sec1, student3, 'ENROLLED', CURRENT_DATE);

  RAISE NOTICE 'WS2 master schedule seed applied for CBSE-DEL-01 (2 sections, 3 rooms, 3 meetings)';
END $$;
