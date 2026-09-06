-- Live multi-board / multi-school onboarding seed
-- Profile: 3 boards × 2 schools × 500 students = 3000 enrollments
-- Idempotent for slug 'proctira-multiboard-cert' (deletes prior cert tenant cascade manually)

\set ON_ERROR_STOP on

-- Tear down previous certification tenant (children first)
DO $$
DECLARE
  tid UUID;
BEGIN
  SELECT id INTO tid FROM tenants WHERE slug = 'proctira-multiboard-cert';
  IF tid IS NOT NULL THEN
    DELETE FROM enrollments WHERE tenant_id = tid;
    DELETE FROM students WHERE tenant_id = tid;
    DELETE FROM staff WHERE tenant_id = tid;
    DELETE FROM institutions WHERE tenant_id = tid;
    DELETE FROM boards WHERE tenant_id = tid;
    DELETE FROM grades WHERE tenant_id = tid;
    DELETE FROM academic_periods WHERE tenant_id = tid;
    DELETE FROM geographic_areas WHERE tenant_id = tid;
    DELETE FROM tenants WHERE id = tid;
  END IF;
END $$;

WITH tenant_ins AS (
  INSERT INTO tenants (id, name, slug, config, status)
  VALUES (
    uuid_generate_v4(),
    'Proctira Multi-Board Certification Tenant',
    'proctira-multiboard-cert',
    '{"locale":"en-IN","timezone":"Asia/Kolkata","certification":true}'::jsonb,
    'active'
  )
  RETURNING id
),
area_ins AS (
  INSERT INTO geographic_areas (id, tenant_id, name, code, level, parent_id, path, lft, rgt)
  SELECT uuid_generate_v4(), t.id, 'Certification District', 'CERT-DIST', 1, NULL, 'CERT-DIST', 1, 2
  FROM tenant_ins t
  RETURNING id, tenant_id
),
period_ins AS (
  INSERT INTO academic_periods (id, tenant_id, name, code, start_date, end_date, status)
  SELECT uuid_generate_v4(), t.id, 'AY 2026-27', 'AY26-27', '2026-04-01', '2027-03-31', 'active'
  FROM tenant_ins t
  RETURNING id, tenant_id
),
grade_ins AS (
  INSERT INTO grades (id, tenant_id, name, code, "order")
  SELECT uuid_generate_v4(), t.id, 'Grade 6', 'G6', 6
  FROM tenant_ins t
  RETURNING id, tenant_id
),
board_rows AS (
  INSERT INTO boards (id, tenant_id, name, code, type, status)
  SELECT uuid_generate_v4(), t.id, v.name, v.code, v.type::board_type, 'active'
  FROM tenant_ins t
  CROSS JOIN (VALUES
    ('Central Board of Secondary Education', 'CBSE', 'NATIONAL'),
    ('Maharashtra State Board', 'MH-STATE', 'STATE'),
    ('Council for the Indian School Certificate Examinations', 'ICSE', 'PRIVATE')
  ) AS v(name, code, type)
  RETURNING id, tenant_id, code
),
school_defs AS (
  SELECT * FROM (VALUES
    ('CBSE', 'CBSE-DEL-01', 'Proctira Model School Delhi'),
    ('CBSE', 'CBSE-NOI-02', 'Proctira International School Noida'),
    ('MH-STATE', 'MH-PUN-01', 'Proctira Vidyalaya Pune'),
    ('MH-STATE', 'MH-MUM-02', 'Proctira High School Mumbai'),
    ('ICSE', 'ICSE-BLR-01', 'Proctira Academy Bengaluru'),
    ('ICSE', 'ICSE-HYD-02', 'Proctira Convent Hyderabad')
  ) AS s(board_code, school_code, school_name)
),
inst_ins AS (
  INSERT INTO institutions (
    id, tenant_id, name, code, board_id, area_id, type, sector, ownership, status, custom_data
  )
  SELECT
    uuid_generate_v4(),
    b.tenant_id,
    sd.school_name,
    sd.school_code,
    b.id,
    a.id,
    'school',
    'government',
    'government',
    'active',
    jsonb_build_object('boardCode', b.code, 'certificationSeed', true)
  FROM school_defs sd
  JOIN board_rows b ON b.code = sd.board_code
  CROSS JOIN area_ins a
  RETURNING id, tenant_id, code, board_id
),
-- 25 staff per school
staff_ins AS (
  INSERT INTO staff (id, tenant_id, first_name, last_name, date_of_birth, identity_number, custom_data)
  SELECT
    uuid_generate_v4(),
    i.tenant_id,
    'Staff',
    i.code || '-' || gs.n::text,
    DATE '1985-01-01' + ((gs.n % 4000) || ' days')::interval,
    'STAFF-' || i.code || '-' || lpad(gs.n::text, 3, '0'),
    jsonb_build_object('institutionCode', i.code)
  FROM inst_ins i
  CROSS JOIN generate_series(1, 25) AS gs(n)
  RETURNING id
),
-- 500 students per school
student_ins AS (
  INSERT INTO students (
    id, tenant_id, first_name, last_name, date_of_birth, gender, national_id, custom_data
  )
  SELECT
    uuid_generate_v4(),
    i.tenant_id,
    'Student',
    i.code || '-' || lpad(gs.n::text, 4, '0'),
    DATE '2012-01-01' + ((gs.n % 1500) || ' days')::interval,
    CASE WHEN gs.n % 2 = 0 THEN 'female' ELSE 'male' END,
    'NID-' || i.code || '-' || lpad(gs.n::text, 4, '0'),
    jsonb_build_object('institutionCode', i.code, 'boardCode', b.code, 'seq', gs.n)
  FROM inst_ins i
  JOIN board_rows b ON b.id = i.board_id
  CROSS JOIN generate_series(1, 500) AS gs(n)
  RETURNING id, tenant_id, custom_data
),
enroll_ins AS (
  INSERT INTO enrollments (
    id, tenant_id, student_id, institution_id, grade_id, academic_period_id, status, enrolled_at
  )
  SELECT
    uuid_generate_v4(),
    s.tenant_id,
    s.id,
    i.id,
    g.id,
    p.id,
    'ENROLLED',
    DATE '2026-04-01'
  FROM student_ins s
  JOIN inst_ins i ON i.code = s.custom_data->>'institutionCode' AND i.tenant_id = s.tenant_id
  CROSS JOIN grade_ins g
  CROSS JOIN period_ins p
  RETURNING id
)
SELECT
  (SELECT count(*) FROM board_rows) AS boards,
  (SELECT count(*) FROM inst_ins) AS schools,
  (SELECT count(*) FROM student_ins) AS students,
  (SELECT count(*) FROM staff_ins) AS staff,
  (SELECT count(*) FROM enroll_ins) AS enrollments;
