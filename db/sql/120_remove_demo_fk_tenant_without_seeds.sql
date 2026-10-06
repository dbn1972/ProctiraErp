-- PRC-M205 — no fixed-UUID demo tenant in databases applied without demo seeds.
--
-- 021a / 071 / 082 / 085 upsert tenant 00000000-0000-4000-8000-000000000001
-- (plus demo student …099 and demo staff …098) with
-- `ON CONFLICT DO UPDATE SET status = 'active', deleted_at = NULL` so FK VALIDATE
-- succeeds when *b_*_seed.sql rows reference them. They are numbered schema
-- migrations, so every environment (production included) got a well-known active
-- tenant. Those files are checksum-ledgered and must not be edited.
--
-- This migration runs after them:
--   * apply-sql.sh binds app.apply_seeds = '1' only for APPLY_SEEDS=1 runs; then
--     the demo rows are kept (seeds need them).
--   * otherwise, when nothing but the demo student/staff references the tenant,
--     the three demo rows are deleted;
--   * when other rows do reference it (e.g. a dev DB seeded earlier), it is
--     suspended + soft-deleted instead of cascading anyone's data away.
--
-- Additive / idempotent (no-op once the tenant is gone or already inert).
-- Needs DB review (data deletion in a migration).
-- CI: tools/scripts/check-migration-tenant-inserts.mjs blocks new
-- `INSERT INTO tenants` in numbered non-seed migrations.

DO $$
DECLARE
  v_tenant  CONSTANT TEXT := '00000000-0000-4000-8000-000000000001';
  v_student CONSTANT TEXT := '00000000-0000-4000-8000-000000000099';
  v_staff   CONSTANT TEXT := '00000000-0000-4000-8000-000000000098';
  r         RECORD;
  v_hit     BOOLEAN;
  v_blocked TEXT := NULL;
BEGIN
  IF COALESCE(current_setting('app.apply_seeds', true), '') = '1' THEN
    RAISE NOTICE 'PRC-M205: APPLY_SEEDS=1 run; demo FK tenant kept for seed data';
    RETURN;
  END IF;

  IF NOT EXISTS (SELECT 1 FROM pg_tables WHERE schemaname = 'public' AND tablename = 'tenants') THEN
    RETURN;
  END IF;

  -- FORCE RLS applies to the owner: make both policy styles see the demo tenant's rows so
  -- the dependency scan below cannot miss hidden rows.
  PERFORM set_config('app.platform_admin', '1', true);
  PERFORM set_config('app.tenant_id', v_tenant, true);

  IF NOT EXISTS (SELECT 1 FROM tenants WHERE id::text = v_tenant) THEN
    RETURN;
  END IF;

  -- 1) Any tenant-scoped row other than the demo student / staff keeps the tenant.
  FOR r IN
    SELECT c.table_name, c.data_type
      FROM information_schema.columns c
      JOIN information_schema.tables t
        ON t.table_schema = c.table_schema AND t.table_name = c.table_name
     WHERE c.table_schema = 'public'
       AND c.column_name = 'tenant_id'
       AND t.table_type = 'BASE TABLE'
       AND c.table_name <> 'tenants'
       AND c.data_type IN ('uuid', 'text', 'character varying')
  LOOP
    EXECUTE format(
      'SELECT EXISTS (SELECT 1 FROM %I WHERE tenant_id = $1%s%s)',
      r.table_name,
      CASE WHEN r.data_type = 'uuid' THEN '::uuid' ELSE '' END,
      CASE
        WHEN r.table_name = 'students' THEN format(' AND id::text <> %L', v_student)
        WHEN r.table_name = 'staff' THEN format(' AND id::text <> %L', v_staff)
        ELSE ''
      END
    ) INTO v_hit USING v_tenant;
    IF v_hit THEN
      v_blocked := r.table_name;
      EXIT;
    END IF;
  END LOOP;

  -- 2) Any FK reference to the demo student / staff keeps them (and so the tenant); so does
  --    any FK to tenants through a column not named tenant_id (covered by step 1).
  IF v_blocked IS NULL THEN
    FOR r IN
      SELECT cl.relname AS table_name, a.attname AS column_name,
             format_type(a.atttypid, a.atttypmod) AS column_type,
             ref.relname AS ref_table
        FROM pg_constraint con
        JOIN pg_class cl  ON cl.oid = con.conrelid
        JOIN pg_class ref ON ref.oid = con.confrelid
        JOIN pg_namespace n ON n.oid = cl.relnamespace
        JOIN pg_attribute a ON a.attrelid = con.conrelid AND a.attnum = con.conkey[1]
       WHERE con.contype = 'f'
         AND n.nspname = 'public'
         AND ref.relname IN ('students', 'staff', 'tenants')
         AND array_length(con.conkey, 1) = 1
         AND NOT (ref.relname = 'tenants' AND a.attname = 'tenant_id')
    LOOP
      -- Compare in the FK column's own type (uuid or text) so its index is usable;
      -- casting the column to text would seq-scan every referencing table.
      EXECUTE format(
        'SELECT EXISTS (SELECT 1 FROM %I WHERE %I = $1::%s)',
        r.table_name,
        r.column_name,
        r.column_type
      ) INTO v_hit USING CASE r.ref_table
                           WHEN 'students' THEN v_student
                           WHEN 'staff' THEN v_staff
                           ELSE v_tenant
                         END;
      IF v_hit THEN
        v_blocked := r.table_name || '.' || r.column_name;
        EXIT;
      END IF;
    END LOOP;
  END IF;

  IF v_blocked IS NULL THEN
    IF EXISTS (SELECT 1 FROM pg_tables WHERE schemaname = 'public' AND tablename = 'staff') THEN
      EXECUTE 'DELETE FROM staff WHERE id::text = $1 AND tenant_id::text = $2' USING v_staff, v_tenant;
    END IF;
    IF EXISTS (SELECT 1 FROM pg_tables WHERE schemaname = 'public' AND tablename = 'students') THEN
      EXECUTE 'DELETE FROM students WHERE id::text = $1 AND tenant_id::text = $2' USING v_student, v_tenant;
    END IF;
    DELETE FROM tenants WHERE id::text = v_tenant;
    RAISE NOTICE 'PRC-M205: removed demo FK tenant % (no dependent rows)', v_tenant;
  ELSE
    UPDATE tenants
       SET status = 'suspended',
           deleted_at = COALESCE(deleted_at, NOW()),
           updated_at = NOW()
     WHERE id::text = v_tenant;
    RAISE NOTICE 'PRC-M205: demo FK tenant % referenced by %; suspended + soft-deleted instead',
      v_tenant, v_blocked;
  END IF;
END $$;

INSERT INTO schema_migrations (filename)
VALUES ('120_remove_demo_fk_tenant_without_seeds.sql')
ON CONFLICT (filename) DO NOTHING;
