-- =============================================================================
-- aitest synthetic tenants (AI test program foundation, program plan D6)
-- =============================================================================
-- Adds two synthetic tenants on top of the repo's e2e and Sunrise seeds:
--   aitest-suspended  00000000-0000-4000-8000-0000000a1701  status 'suspended',
--                     one district + one institution (tenant lifecycle checks)
--   aitest-empty      00000000-0000-4000-8000-0000000a1702  active, no data
-- and binds one student per rich tenant (S, A) to a synthetic portal sub.
-- No real personal data. Throwaway aitest stacks only: applied by
-- tools/aitest/src/foundation/seed/seed.ts as the migrator (proctira,
-- NOSUPERUSER NOBYPASSRLS) with PGOPTIONS "-c proctira.allow_aitest_seed=on"
-- for that one psql connection. Without the guard the first statement raises
-- and nothing is written. FORCE RLS scopes are bound transaction-locally, as
-- in tools/e2e/seed-e2e-tenants.sql. Idempotent.
-- =============================================================================
\set ON_ERROR_STOP on
BEGIN;
DO $$
BEGIN
  IF current_setting('proctira.allow_aitest_seed', true) IS DISTINCT FROM 'on' THEN
    RAISE EXCEPTION 'aitest tenants are guarded: apply them with the aitest stack seeder (sets proctira.allow_aitest_seed=on)'
      USING ERRCODE = 'insufficient_privilege';
  END IF;
END $$;
DO $$ BEGIN PERFORM set_config('app.platform_admin', '1', true); END $$;
INSERT INTO tenants (id, name, slug, config, status)
VALUES
  ('00000000-0000-4000-8000-0000000a1701', 'aitest Suspended Tenant', 'aitest-suspended', '{"aitest":true}'::jsonb, 'suspended'),
  ('00000000-0000-4000-8000-0000000a1702', 'aitest Empty Tenant',     'aitest-empty',     '{"aitest":true}'::jsonb, 'active')
ON CONFLICT (id) DO UPDATE
  SET status = EXCLUDED.status,
      deleted_at = NULL,
      updated_at = now()
  WHERE tenants.slug = EXCLUDED.slug;
DO $$ BEGIN PERFORM set_config('app.tenant_id', '00000000-0000-4000-8000-0000000a1701', true); END $$;
INSERT INTO geographic_areas (id, tenant_id, name, code, level, parent_id, path, lft, rgt)
VALUES (
  '00000000-0000-4000-8000-0000000a17a1',
  '00000000-0000-4000-8000-0000000a1701',
  'aitest District', 'AIT-DIST', 1, NULL, '/AIT-DIST', 1, 2
)
ON CONFLICT (id) DO UPDATE SET deleted_at = NULL, updated_at = now();
INSERT INTO institutions (id, tenant_id, name, code, area_id, type, sector, ownership, status, custom_data)
VALUES (
  '00000000-0000-4000-8000-0000000a17b1',
  '00000000-0000-4000-8000-0000000a1701',
  'aitest Suspended School', 'AIT-SUSP-001',
  '00000000-0000-4000-8000-0000000a17a1',
  'school', 'public', 'government', 'active', '{"aitest":true}'::jsonb
)
ON CONFLICT (id) DO UPDATE SET status = 'active', deleted_at = NULL, updated_at = now();
-- Student portal self-binding (PRC-H075: students.custom_data.user_id is the
-- sub the student portal serves), so the token factory can mint a student
-- principal that owns a record: Sunrise UAT portal student (…a5b1) and the
-- tenant A parent-portal student (…0099). An existing binding is kept.
DO $$ BEGIN PERFORM set_config('app.tenant_id', '00000000-0000-4000-8000-00000000a501', true); END $$;
UPDATE students
   SET custom_data = coalesce(custom_data, '{}'::jsonb) || '{"user_id":"aitest-student-s"}'::jsonb
 WHERE tenant_id = '00000000-0000-4000-8000-00000000a501'
   AND id = '00000000-0000-4000-8000-00000000a5b1'
   AND NOT coalesce(custom_data, '{}'::jsonb) ? 'user_id';
DO $$ BEGIN PERFORM set_config('app.tenant_id', '00000000-0000-4000-8000-000000000001', true); END $$;
UPDATE students
   SET custom_data = coalesce(custom_data, '{}'::jsonb) || '{"user_id":"aitest-student-a"}'::jsonb
 WHERE tenant_id = '00000000-0000-4000-8000-000000000001'
   AND id = '00000000-0000-4000-8000-000000000099'
   AND NOT coalesce(custom_data, '{}'::jsonb) ? 'user_id';
DO $$
BEGIN
  IF (SELECT count(*) FROM tenants
       WHERE (id, slug, status) IN (
         ('00000000-0000-4000-8000-0000000a1701'::uuid, 'aitest-suspended', 'suspended'),
         ('00000000-0000-4000-8000-0000000a1702'::uuid, 'aitest-empty', 'active'))) <> 2 THEN
    RAISE EXCEPTION 'aitest tenant ids are held by other tenants; recreate the throwaway database';
  END IF;
END $$;
COMMIT;
