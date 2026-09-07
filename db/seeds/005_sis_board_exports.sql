-- WS4 board export pack fixtures: complete grades for one student per board
-- (CBSE / ICSE / MH-STATE) plus one incomplete cohort student for 422 tests.
-- Idempotent for slug proctira-multiboard-cert.

\set ON_ERROR_STOP on

DO $$
DECLARE
  tid UUID;
  bid_cbse UUID;
  bid_icse UUID;
  bid_mh UUID;
  inst_cbse UUID;
  inst_icse UUID;
  inst_mh UUID;
  period_id UUID;
  sec_cbse UUID;
  sec_icse UUID;
  sec_mh UUID;
  stu_cbse UUID;
  stu_icse UUID;
  stu_mh UUID;
  stu_incomplete UUID;
BEGIN
  SELECT id INTO tid FROM tenants WHERE slug = 'proctira-multiboard-cert' AND deleted_at IS NULL;
  IF tid IS NULL THEN
    RAISE NOTICE 'Tenant proctira-multiboard-cert not found — skipping board export seed';
    RETURN;
  END IF;

  SELECT id INTO bid_cbse FROM boards WHERE tenant_id = tid AND code = 'CBSE' AND deleted_at IS NULL;
  SELECT id INTO bid_icse FROM boards WHERE tenant_id = tid AND code = 'ICSE' AND deleted_at IS NULL;
  SELECT id INTO bid_mh   FROM boards WHERE tenant_id = tid AND code = 'MH-STATE' AND deleted_at IS NULL;

  SELECT i.id INTO inst_cbse FROM institutions i WHERE i.tenant_id = tid AND i.code = 'CBSE-DEL-01' AND i.deleted_at IS NULL;
  SELECT i.id INTO inst_icse FROM institutions i WHERE i.tenant_id = tid AND i.code = 'ICSE-BLR-01' AND i.deleted_at IS NULL;
  SELECT i.id INTO inst_mh   FROM institutions i WHERE i.tenant_id = tid AND i.code = 'MH-PUN-01' AND i.deleted_at IS NULL;

  SELECT ap.id INTO period_id
  FROM academic_periods ap
  WHERE ap.tenant_id = tid AND ap.deleted_at IS NULL
  ORDER BY ap.created_at
  LIMIT 1;

  IF inst_cbse IS NULL OR inst_icse IS NULL OR inst_mh IS NULL OR period_id IS NULL THEN
    RAISE EXCEPTION 'Missing institution or academic period for board export seed';
  END IF;

  -- Demo sections per board school
  INSERT INTO sections (id, tenant_id, institution_id, academic_period_id, code, name, capacity, status, metadata)
  VALUES
    (uuid_generate_v4(), tid, inst_cbse, period_id, '10-A', 'Class 10-A Gradebook Demo', 40, 'PUBLISHED',
      '{"seed":"005_sis_board_exports"}'::jsonb),
    (uuid_generate_v4(), tid, inst_icse, period_id, '10-ICSE-A', 'ICSE Class 10 Export Demo', 40, 'PUBLISHED',
      '{"seed":"005_sis_board_exports"}'::jsonb),
    (uuid_generate_v4(), tid, inst_mh, period_id, '10-MH-A', 'MH Class 10 Export Demo', 40, 'PUBLISHED',
      '{"seed":"005_sis_board_exports"}'::jsonb)
  ON CONFLICT (tenant_id, institution_id, academic_period_id, code) DO UPDATE
    SET name = EXCLUDED.name, status = EXCLUDED.status, metadata = EXCLUDED.metadata,
        updated_at = NOW(), deleted_at = NULL;

  SELECT s.id INTO sec_cbse FROM sections s
  WHERE s.tenant_id = tid AND s.institution_id = inst_cbse AND s.code = '10-A' AND s.deleted_at IS NULL;
  SELECT s.id INTO sec_icse FROM sections s
  WHERE s.tenant_id = tid AND s.institution_id = inst_icse AND s.code = '10-ICSE-A' AND s.deleted_at IS NULL;
  SELECT s.id INTO sec_mh FROM sections s
  WHERE s.tenant_id = tid AND s.institution_id = inst_mh AND s.code = '10-MH-A' AND s.deleted_at IS NULL;

  -- Prefer students already enrolled at each school (first by national_id)
  SELECT e.student_id INTO stu_cbse
  FROM enrollments e JOIN students s ON s.id = e.student_id
  WHERE e.tenant_id = tid AND e.institution_id = inst_cbse AND e.status = 'ENROLLED'
  ORDER BY s.national_id LIMIT 1;

  SELECT e.student_id INTO stu_icse
  FROM enrollments e JOIN students s ON s.id = e.student_id
  WHERE e.tenant_id = tid AND e.institution_id = inst_icse AND e.status = 'ENROLLED'
  ORDER BY s.national_id LIMIT 1;

  SELECT e.student_id INTO stu_mh
  FROM enrollments e JOIN students s ON s.id = e.student_id
  WHERE e.tenant_id = tid AND e.institution_id = inst_mh AND e.status = 'ENROLLED'
  ORDER BY s.national_id LIMIT 1;

  -- Second CBSE student used for incomplete-grade 422 tests
  SELECT e.student_id INTO stu_incomplete
  FROM enrollments e JOIN students s ON s.id = e.student_id
  WHERE e.tenant_id = tid AND e.institution_id = inst_cbse AND e.status = 'ENROLLED'
    AND e.student_id <> stu_cbse
  ORDER BY s.national_id LIMIT 1;

  IF stu_cbse IS NULL OR stu_icse IS NULL OR stu_mh IS NULL THEN
    RAISE EXCEPTION 'Missing enrolled students for board export seed';
  END IF;

  -- Ensure section enrollments for demo students
  INSERT INTO section_enrollments (id, tenant_id, section_id, student_id, status, enrolled_at)
  VALUES
    (uuid_generate_v4(), tid, sec_cbse, stu_cbse, 'ENROLLED', CURRENT_DATE),
    (uuid_generate_v4(), tid, sec_icse, stu_icse, 'ENROLLED', CURRENT_DATE),
    (uuid_generate_v4(), tid, sec_mh, stu_mh, 'ENROLLED', CURRENT_DATE)
  ON CONFLICT (section_id, student_id) DO UPDATE
    SET status = 'ENROLLED', updated_at = NOW();

  -- Helper: upsert grade via delete+insert on unique key (tenant, student, section, assessment)
  -- CBSE required: ENG, MATH, SCI, SST
  DELETE FROM grade_entries
  WHERE tenant_id = tid AND student_id = stu_cbse AND section_id = sec_cbse
    AND assessment_code IN ('ENG','MATH','SCI','SST');
  INSERT INTO grade_entries (id, tenant_id, section_id, student_id, assessment_code, numeric_score, letter_grade, entered_at, metadata)
  VALUES
    (uuid_generate_v4(), tid, sec_cbse, stu_cbse, 'ENG', 88, NULL, NOW(), '{"seed":"005_sis_board_exports","board":"CBSE"}'::jsonb),
    (uuid_generate_v4(), tid, sec_cbse, stu_cbse, 'MATH', 95, NULL, NOW(), '{"seed":"005_sis_board_exports","board":"CBSE"}'::jsonb),
    (uuid_generate_v4(), tid, sec_cbse, stu_cbse, 'SCI', 84, NULL, NOW(), '{"seed":"005_sis_board_exports","board":"CBSE"}'::jsonb),
    (uuid_generate_v4(), tid, sec_cbse, stu_cbse, 'SST', 79, NULL, NOW(), '{"seed":"005_sis_board_exports","board":"CBSE"}'::jsonb);

  -- ICSE required: ENG, MATH, SCI, HIST
  DELETE FROM grade_entries
  WHERE tenant_id = tid AND student_id = stu_icse AND section_id = sec_icse
    AND assessment_code IN ('ENG','MATH','SCI','HIST');
  INSERT INTO grade_entries (id, tenant_id, section_id, student_id, assessment_code, numeric_score, letter_grade, entered_at, metadata)
  VALUES
    (uuid_generate_v4(), tid, sec_icse, stu_icse, 'ENG', 91, NULL, NOW(), '{"seed":"005_sis_board_exports","board":"ICSE"}'::jsonb),
    (uuid_generate_v4(), tid, sec_icse, stu_icse, 'MATH', 86, NULL, NOW(), '{"seed":"005_sis_board_exports","board":"ICSE"}'::jsonb),
    (uuid_generate_v4(), tid, sec_icse, stu_icse, 'SCI', 82, NULL, NOW(), '{"seed":"005_sis_board_exports","board":"ICSE"}'::jsonb),
    (uuid_generate_v4(), tid, sec_icse, stu_icse, 'HIST', 77, NULL, NOW(), '{"seed":"005_sis_board_exports","board":"ICSE"}'::jsonb);

  -- MH-STATE required: ENG, MATH, SCI, SOC
  DELETE FROM grade_entries
  WHERE tenant_id = tid AND student_id = stu_mh AND section_id = sec_mh
    AND assessment_code IN ('ENG','MATH','SCI','SOC');
  INSERT INTO grade_entries (id, tenant_id, section_id, student_id, assessment_code, numeric_score, letter_grade, entered_at, metadata)
  VALUES
    (uuid_generate_v4(), tid, sec_mh, stu_mh, 'ENG', 74, NULL, NOW(), '{"seed":"005_sis_board_exports","board":"MH-STATE"}'::jsonb),
    (uuid_generate_v4(), tid, sec_mh, stu_mh, 'MATH', 68, NULL, NOW(), '{"seed":"005_sis_board_exports","board":"MH-STATE"}'::jsonb),
    (uuid_generate_v4(), tid, sec_mh, stu_mh, 'SCI', 71, NULL, NOW(), '{"seed":"005_sis_board_exports","board":"MH-STATE"}'::jsonb),
    (uuid_generate_v4(), tid, sec_mh, stu_mh, 'SOC', 66, NULL, NOW(), '{"seed":"005_sis_board_exports","board":"MH-STATE"}'::jsonb);

  -- Incomplete CBSE student: only MATH (for 422 smoke when studentIds scoped)
  IF stu_incomplete IS NOT NULL THEN
    DELETE FROM grade_entries
    WHERE tenant_id = tid AND student_id = stu_incomplete
      AND assessment_code IN ('ENG','MATH','SCI','SST')
      AND metadata->>'seed' = '005_sis_board_exports';
    INSERT INTO grade_entries (id, tenant_id, section_id, student_id, assessment_code, numeric_score, letter_grade, entered_at, metadata)
    VALUES
      (uuid_generate_v4(), tid, sec_cbse, stu_incomplete, 'MATH', 55, NULL, NOW(),
        '{"seed":"005_sis_board_exports","board":"CBSE","incomplete":true}'::jsonb);
  END IF;

  RAISE NOTICE 'Seeded board export grades: CBSE=% ICSE=% MH=% incomplete=%',
    stu_cbse, stu_icse, stu_mh, stu_incomplete;
END $$;
