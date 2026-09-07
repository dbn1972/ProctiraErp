-- Board codes + grading scales for CBSE / ICSE / MH-STATE
-- Tied to existing cert tenant slug 'proctira-multiboard-cert' when present.
-- Idempotent: deletes prior scale/code rows for that tenant before insert.

\set ON_ERROR_STOP on

DO $$
DECLARE
  tid UUID;
  bid_cbse UUID;
  bid_icse UUID;
  bid_mh UUID;
  scale_cbse UUID;
  scale_icse UUID;
  scale_mh UUID;
  inst RECORD;
BEGIN
  SELECT id INTO tid FROM tenants WHERE slug = 'proctira-multiboard-cert' AND deleted_at IS NULL;
  IF tid IS NULL THEN
    RAISE NOTICE 'Tenant proctira-multiboard-cert not found — skipping board scale seed';
    RETURN;
  END IF;

  SELECT id INTO bid_cbse FROM boards WHERE tenant_id = tid AND code = 'CBSE' AND deleted_at IS NULL;
  SELECT id INTO bid_icse FROM boards WHERE tenant_id = tid AND code = 'ICSE' AND deleted_at IS NULL;
  SELECT id INTO bid_mh   FROM boards WHERE tenant_id = tid AND code = 'MH-STATE' AND deleted_at IS NULL;

  IF bid_cbse IS NULL OR bid_icse IS NULL OR bid_mh IS NULL THEN
    RAISE EXCEPTION 'Expected CBSE, ICSE, MH-STATE boards on cert tenant';
  END IF;

  -- Tear down prior seed rows for this tenant (children first)
  DELETE FROM grading_scale_bands WHERE tenant_id = tid;
  DELETE FROM grading_scales WHERE tenant_id = tid;
  DELETE FROM board_codes WHERE tenant_id = tid;

  -- Board affiliation / centre codes per institution
  FOR inst IN
    SELECT i.id AS institution_id, i.code AS institution_code, b.id AS board_id, b.code AS board_code
    FROM institutions i
    JOIN boards b ON b.id = i.board_id
    WHERE i.tenant_id = tid AND i.deleted_at IS NULL
  LOOP
    INSERT INTO board_codes (
      id, tenant_id, board_id, institution_id, code_type, code_value, label, metadata
    ) VALUES (
      uuid_generate_v4(),
      tid,
      inst.board_id,
      inst.institution_id,
      'AFFILIATION',
      inst.board_code || '-AFF-' || inst.institution_code,
      inst.board_code || ' affiliation for ' || inst.institution_code,
      jsonb_build_object('boardCode', inst.board_code, 'seed', '003_sis_timetable_board_scales')
    );

    INSERT INTO board_codes (
      id, tenant_id, board_id, institution_id, code_type, code_value, label, metadata
    ) VALUES (
      uuid_generate_v4(),
      tid,
      inst.board_id,
      inst.institution_id,
      'CENTRE',
      inst.board_code || '-CTR-' || inst.institution_code,
      inst.board_code || ' exam centre for ' || inst.institution_code,
      jsonb_build_object('boardCode', inst.board_code, 'seed', '003_sis_timetable_board_scales')
    );
  END LOOP;

  -- CBSE 9-point percent bands
  scale_cbse := uuid_generate_v4();
  INSERT INTO grading_scales (id, tenant_id, board_id, code, name, scale_type, is_default, metadata)
  VALUES (
    scale_cbse, tid, bid_cbse, 'CBSE-9PT', 'CBSE 9-point scale', 'PERCENT_BAND', TRUE,
    '{"board":"CBSE","source":"003_sis_timetable_board_scales"}'::jsonb
  );

  INSERT INTO grading_scale_bands (id, tenant_id, grading_scale_id, label, min_percent, max_percent, grade_points, sort_order)
  SELECT uuid_generate_v4(), tid, scale_cbse, v.label, v.min_p, v.max_p, v.gp, v.ord
  FROM (VALUES
    ('A1', 91.00, 100.00, 10.00::numeric, 1),
    ('A2', 81.00,  90.99,  9.00, 2),
    ('B1', 71.00,  80.99,  8.00, 3),
    ('B2', 61.00,  70.99,  7.00, 4),
    ('C1', 51.00,  60.99,  6.00, 5),
    ('C2', 41.00,  50.99,  5.00, 6),
    ('D',  33.00,  40.99,  4.00, 7),
    ('E',   0.00,  32.99,  0.00, 8)
  ) AS v(label, min_p, max_p, gp, ord);

  -- ICSE percentage + letter bands
  scale_icse := uuid_generate_v4();
  INSERT INTO grading_scales (id, tenant_id, board_id, code, name, scale_type, is_default, metadata)
  VALUES (
    scale_icse, tid, bid_icse, 'ICSE-STD', 'ICSE standard bands', 'PERCENT_BAND', TRUE,
    '{"board":"ICSE","source":"003_sis_timetable_board_scales"}'::jsonb
  );

  INSERT INTO grading_scale_bands (id, tenant_id, grading_scale_id, label, min_percent, max_percent, grade_points, sort_order)
  SELECT uuid_generate_v4(), tid, scale_icse, v.label, v.min_p, v.max_p, v.gp, v.ord
  FROM (VALUES
    ('1', 90.00, 100.00, 10.00::numeric, 1),
    ('2', 80.00,  89.99,  9.00, 2),
    ('3', 70.00,  79.99,  8.00, 3),
    ('4', 60.00,  69.99,  7.00, 4),
    ('5', 50.00,  59.99,  6.00, 5),
    ('6', 40.00,  49.99,  5.00, 6),
    ('7', 35.00,  39.99,  4.00, 7),
    ('Fail', 0.00, 34.99, 0.00, 8)
  ) AS v(label, min_p, max_p, gp, ord);

  -- Maharashtra State Board
  scale_mh := uuid_generate_v4();
  INSERT INTO grading_scales (id, tenant_id, board_id, code, name, scale_type, is_default, metadata)
  VALUES (
    scale_mh, tid, bid_mh, 'MH-STATE-STD', 'MH State percent bands', 'PERCENT_BAND', TRUE,
    '{"board":"MH-STATE","source":"003_sis_timetable_board_scales"}'::jsonb
  );

  INSERT INTO grading_scale_bands (id, tenant_id, grading_scale_id, label, min_percent, max_percent, grade_points, sort_order)
  SELECT uuid_generate_v4(), tid, scale_mh, v.label, v.min_p, v.max_p, v.gp, v.ord
  FROM (VALUES
    ('Distinction', 75.00, 100.00, 10.00::numeric, 1),
    ('First',       60.00,  74.99,  8.00, 2),
    ('Second',      45.00,  59.99,  6.00, 3),
    ('Pass',        35.00,  44.99,  4.00, 4),
    ('Fail',         0.00,  34.99,  0.00, 5)
  ) AS v(label, min_p, max_p, gp, ord);

  RAISE NOTICE 'Seeded board_codes + grading_scales for tenant %', tid;
END $$;
