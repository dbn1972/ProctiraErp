-- WS3 credit rules + demo section for gradebook (cert tenant)
-- Idempotent for slug proctira-multiboard-cert.

\set ON_ERROR_STOP on

DO $$
DECLARE
  tid UUID;
  bid_cbse UUID;
  bid_icse UUID;
  bid_mh UUID;
  inst_id UUID;
  period_id UUID;
  demo_section_id UUID;
  student_a UUID;
  student_b UUID;
BEGIN
  SELECT id INTO tid FROM tenants WHERE slug = 'proctira-multiboard-cert' AND deleted_at IS NULL;
  IF tid IS NULL THEN
    RAISE NOTICE 'Tenant proctira-multiboard-cert not found — skipping gradebook seed';
    RETURN;
  END IF;

  SELECT id INTO bid_cbse FROM boards WHERE tenant_id = tid AND code = 'CBSE' AND deleted_at IS NULL;
  SELECT id INTO bid_icse FROM boards WHERE tenant_id = tid AND code = 'ICSE' AND deleted_at IS NULL;
  SELECT id INTO bid_mh   FROM boards WHERE tenant_id = tid AND code = 'MH-STATE' AND deleted_at IS NULL;

  -- Credit rules (board-aware)
  INSERT INTO credit_rules (id, tenant_id, board_id, code, name, credits, metadata)
  VALUES
    (uuid_generate_v4(), tid, bid_cbse, 'CBSE-CORE', 'CBSE core subject', 1.00,
      '{"minPercent":33,"board":"CBSE","seed":"004_sis_gradebook"}'::jsonb),
    (uuid_generate_v4(), tid, bid_cbse, 'CBSE-ELECTIVE', 'CBSE elective', 0.50,
      '{"minPercent":33,"board":"CBSE","seed":"004_sis_gradebook"}'::jsonb),
    (uuid_generate_v4(), tid, bid_icse, 'ICSE-CORE', 'ICSE core subject', 1.00,
      '{"minPercent":35,"board":"ICSE","seed":"004_sis_gradebook"}'::jsonb),
    (uuid_generate_v4(), tid, bid_mh, 'MH-CORE', 'MH State core subject', 1.00,
      '{"minPercent":35,"board":"MH-STATE","seed":"004_sis_gradebook"}'::jsonb)
  ON CONFLICT (tenant_id, code) DO UPDATE
    SET name = EXCLUDED.name,
        credits = EXCLUDED.credits,
        board_id = EXCLUDED.board_id,
        metadata = EXCLUDED.metadata,
        updated_at = NOW(),
        deleted_at = NULL;

  SELECT i.id INTO inst_id
  FROM institutions i
  WHERE i.tenant_id = tid AND i.code = 'CBSE-DEL-01' AND i.deleted_at IS NULL
  LIMIT 1;

  SELECT ap.id INTO period_id
  FROM academic_periods ap
  WHERE ap.tenant_id = tid AND ap.deleted_at IS NULL
  ORDER BY ap.created_at
  LIMIT 1;

  IF inst_id IS NULL OR period_id IS NULL THEN
    RAISE NOTICE 'Missing institution or academic period — credit rules only';
    RETURN;
  END IF;

  INSERT INTO sections (
    id, tenant_id, institution_id, academic_period_id, code, name,
    capacity, status, metadata
  ) VALUES (
    uuid_generate_v4(), tid, inst_id, period_id, '10-A', 'Class 10-A Gradebook Demo',
    40, 'PUBLISHED',
    '{"seed":"004_sis_gradebook","purpose":"WS3 gradebook"}'::jsonb
  )
  ON CONFLICT (tenant_id, institution_id, academic_period_id, code) DO UPDATE
    SET name = EXCLUDED.name,
        status = EXCLUDED.status,
        metadata = EXCLUDED.metadata,
        updated_at = NOW(),
        deleted_at = NULL
  RETURNING id INTO demo_section_id;

  IF demo_section_id IS NULL THEN
    SELECT s.id INTO demo_section_id FROM sections s
    WHERE s.tenant_id = tid AND s.institution_id = inst_id
      AND s.academic_period_id = period_id AND s.code = '10-A' AND s.deleted_at IS NULL;
  END IF;

  SELECT s.id INTO student_a
  FROM students s
  WHERE s.tenant_id = tid AND s.deleted_at IS NULL
  ORDER BY s.created_at
  LIMIT 1;

  SELECT s.id INTO student_b
  FROM students s
  WHERE s.tenant_id = tid AND s.deleted_at IS NULL AND s.id <> student_a
  ORDER BY s.created_at
  LIMIT 1;

  IF demo_section_id IS NOT NULL AND student_a IS NOT NULL THEN
    INSERT INTO section_enrollments (id, tenant_id, section_id, student_id, status)
    VALUES (uuid_generate_v4(), tid, demo_section_id, student_a, 'ENROLLED')
    ON CONFLICT (section_id, student_id) DO NOTHING;
  END IF;

  IF demo_section_id IS NOT NULL AND student_b IS NOT NULL THEN
    INSERT INTO section_enrollments (id, tenant_id, section_id, student_id, status)
    VALUES (uuid_generate_v4(), tid, demo_section_id, student_b, 'ENROLLED')
    ON CONFLICT (section_id, student_id) DO NOTHING;
  END IF;

  RAISE NOTICE 'Seeded credit_rules + section 10-A (%) for tenant %', demo_section_id, tid;
END $$;
