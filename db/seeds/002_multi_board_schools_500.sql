-- Live multi-board / multi-school onboarding seed
-- Profile: 3 boards × 2 schools × 500 students = 3000 class-placed enrollments
-- Idempotent for slug 'proctira-multiboard-cert' (deletes prior cert tenant cascade manually)
--
-- RLS: this seed runs under the production posture (NOSUPERUSER / NOBYPASSRLS
-- app role, FORCE RLS). `tenants` admits writes only with app.platform_admin
-- bound; every domain table only with app.tenant_id = its tenant. Both are
-- bound transaction-locally below, so nothing leaks into the session, and the
-- certification tenant id is fixed so the domain inserts can be pre-scoped.

\set ON_ERROR_STOP on

BEGIN;
DO $$ BEGIN PERFORM set_config('app.platform_admin', '1', true); END $$;

-- Tear down previous certification tenant (children first)
DO $$
DECLARE
  tid UUID;
BEGIN
  SELECT id INTO tid FROM tenants WHERE slug = 'proctira-multiboard-cert';
  IF tid IS NOT NULL THEN
    -- Scope the deletes to whichever id the previous run used.
    PERFORM set_config('app.tenant_id', tid::text, true);
    -- SIS foundation children (003) — ignore if tables not yet applied
    BEGIN DELETE FROM substitutions WHERE tenant_id = tid; EXCEPTION WHEN undefined_table THEN NULL; END;
    BEGIN DELETE FROM section_meetings WHERE tenant_id = tid; EXCEPTION WHEN undefined_table THEN NULL; END;
    BEGIN DELETE FROM section_enrollments WHERE tenant_id = tid; EXCEPTION WHEN undefined_table THEN NULL; END;
    BEGIN DELETE FROM grade_entries WHERE tenant_id = tid; EXCEPTION WHEN undefined_table THEN NULL; END;
    BEGIN DELETE FROM gpa_snapshots WHERE tenant_id = tid; EXCEPTION WHEN undefined_table THEN NULL; END;
    BEGIN DELETE FROM transcript_issuances WHERE tenant_id = tid; EXCEPTION WHEN undefined_table THEN NULL; END;
    BEGIN DELETE FROM board_export_jobs WHERE tenant_id = tid; EXCEPTION WHEN undefined_table THEN NULL; END;
    BEGIN DELETE FROM sections WHERE tenant_id = tid; EXCEPTION WHEN undefined_table THEN NULL; END;
    BEGIN DELETE FROM bell_periods WHERE tenant_id = tid; EXCEPTION WHEN undefined_table THEN NULL; END;
    BEGIN DELETE FROM bell_schedules WHERE tenant_id = tid; EXCEPTION WHEN undefined_table THEN NULL; END;
    BEGIN DELETE FROM rooms WHERE tenant_id = tid; EXCEPTION WHEN undefined_table THEN NULL; END;
    BEGIN DELETE FROM grading_scale_bands WHERE tenant_id = tid; EXCEPTION WHEN undefined_table THEN NULL; END;
    BEGIN DELETE FROM grading_scales WHERE tenant_id = tid; EXCEPTION WHEN undefined_table THEN NULL; END;
    BEGIN DELETE FROM credit_rules WHERE tenant_id = tid; EXCEPTION WHEN undefined_table THEN NULL; END;
    BEGIN DELETE FROM board_codes WHERE tenant_id = tid; EXCEPTION WHEN undefined_table THEN NULL; END;
    -- KNOWN LIMITATION, not fixable here: this teardown cannot run twice against a
    -- database where the certification tenant has accumulated enrollment history.
    -- `enrollment_history` references `enrollments`, so the DELETE below needs it
    -- cleared first —
    --   ERROR: update or delete on table "enrollments" violates foreign key
    --          constraint "enrollment_history_enrollment_id_fkey"
    -- — but `enrollment_history` is append-only by trigger
    -- (db/sql/080_enrollment_grade_audit_harden.sql):
    --   ERROR: enrollment_history is append-only (DELETE rejected)
    -- so there is no delete order that satisfies both. The seed is effectively
    -- single-use per database once history exists; re-seeding needs a fresh database
    -- or a deliberate, audited archival of that history. Reconciling the two is its
    -- own change — do not "fix" it by loosening the append-only trigger, which is a
    -- W1-DATA-07 audit invariant. Found by re-applying this seed while verifying the
    -- config shape below.
    DELETE FROM enrollments WHERE tenant_id = tid;
    DELETE FROM classes WHERE tenant_id = tid;
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

DO $$ BEGIN PERFORM set_config('app.tenant_id', '00000000-0000-4000-8000-00000000ce27', true); END $$;

WITH tenant_ins AS (
  -- `timezone` is set explicitly. The column defaults to 'UTC' and
  -- `resolveTenantTimezone` ranks it *first*, ahead of anything in `config` — so
  -- while this insert omitted it, an Indian multi-board certification tenant
  -- resolved to UTC and the Asia/Kolkata in its config was dead weight. Every
  -- timestamp the certification suite produced was in the wrong zone.
  INSERT INTO tenants (id, name, slug, timezone, config, status)
  VALUES (
    '00000000-0000-4000-8000-00000000ce27',
    'Proctira Multi-Board Certification Tenant',
    'proctira-multiboard-cert',
    'Asia/Kolkata',
    -- Shape matters here. `TenantConfigSchema` (packages/backend/tenant/src/schemas.ts)
    -- declares `locale` as an object with three required fields; this row used to
    -- write it as the bare string "en-IN" with a sibling "timezone".
    --
    -- `resolveTenantTimezone` tolerates the flat form (it is priority 4 of its
    -- candidate list), so the timezone kept resolving and the mismatch stayed
    -- invisible. Fastify's response serializer does not tolerate it: served through
    -- `TenantConfigSchema` this row yields `500 "defaultLocale" is required!`, because
    -- fast-json-stringify throws rather than emit a partial object.
    --
    -- Latent, not live: `routes.ts` declares no `schema:` block, so `config` is
    -- returned raw today and nothing serializes it through `TenantConfigSchema`.
    -- `TenantResponseSchema` exists to be attached to those routes, and whoever
    -- attaches it inherits the 500 for any row still holding the flat shape.
    --
    -- Scope of this change: the seed only. Rows that already hold the flat shape are
    -- NOT repaired here, and deliberately not repaired on read either — normalizing
    -- in the repository would change a live response body, and `updateTenant`
    -- persists what it read via `mirrorToTenantRow`, so a name-only edit would write
    -- back a `supportedLocales` nobody supplied. Repairing existing rows is a forward
    -- migration's job (it must cover `control_plane_documents` tenant documents as
    -- well as `tenants.config`), tracked separately.
    --
    -- The flat `timezone` is kept alongside the nested one on purpose:
    -- `resolveTenantTimezone` reads `config.timezone` as one of its candidates, so
    -- dropping it here would make a freshly-seeded database resolve differently from
    -- one carrying the legacy row. `certification` is kept because it is stored state;
    -- `TenantConfigSchema` does not declare it, so a schema-bearing route omits it.
    '{"locale":{"defaultLocale":"en-IN","supportedLocales":["en-IN"],"timezone":"Asia/Kolkata"},"timezone":"Asia/Kolkata","certification":true}'::jsonb,
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
-- One Grade 6 class per school, sized to the certification roster.
class_ins AS (
  INSERT INTO classes (
    id, tenant_id, institution_id, grade_id, academic_period_id, name, capacity
  )
  SELECT
    uuid_generate_v4(),
    i.tenant_id,
    i.id,
    g.id,
    p.id,
    'Grade 6 - A',
    500
  FROM inst_ins i
  CROSS JOIN grade_ins g
  CROSS JOIN period_ins p
  RETURNING id, tenant_id, institution_id, grade_id, academic_period_id
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
    id, tenant_id, student_id, institution_id, grade_id, academic_period_id, class_id,
    status, enrolled_at
  )
  SELECT
    uuid_generate_v4(),
    s.tenant_id,
    s.id,
    i.id,
    c.grade_id,
    c.academic_period_id,
    c.id,
    'ENROLLED',
    DATE '2026-04-01'
  FROM student_ins s
  JOIN inst_ins i ON i.code = s.custom_data->>'institutionCode' AND i.tenant_id = s.tenant_id
  JOIN class_ins c ON c.institution_id = i.id AND c.tenant_id = s.tenant_id
  RETURNING id
)
SELECT
  (SELECT count(*) FROM board_rows) AS boards,
  (SELECT count(*) FROM inst_ins) AS schools,
  (SELECT count(*) FROM class_ins) AS classes,
  (SELECT count(*) FROM student_ins) AS students,
  (SELECT count(*) FROM staff_ins) AS staff,
  (SELECT count(*) FROM enroll_ins) AS enrollments;

COMMIT;
