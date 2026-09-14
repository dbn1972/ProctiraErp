-- W1-DATA-06 COMPLETE — repair prior no-op VALIDATE installs.
--
-- Residual: 068 could be recorded while 021b was skipped (APPLY_STRICT_FKS=0),
-- so later enabling strict FKs left tenant_id FKs missing or stuck NOT VALID
-- forever (068 ledger skip). This forward migration re-runs create + VALIDATE
-- and fail-closes if any uuid tenant_id → tenants(id) FK remains unvalidated
-- or missing.
--
-- Gated by apply-sql.sh APPLY_STRICT_FKS (same as 021a/021b/068). Idempotent
-- when constraints already exist and are validated.

-- Ensure demo / seed tenant exists before VALIDATE (same UUID as 021a).
DO $$ BEGIN
  PERFORM set_config('app.platform_admin', '1', true);
END $$;

INSERT INTO tenants (id, name, slug, config, status)
VALUES (
  '00000000-0000-4000-8000-000000000001',
  'Strict-FK demo tenant',
  'strict-fk-demo',
  '{}'::jsonb,
  'active'
)
ON CONFLICT (id) DO UPDATE
  SET status = 'active',
      deleted_at = NULL,
      updated_at = NOW();

-- 1) Create missing tenant_id → tenants(id) FKs as NOT VALID (same as 021b).
DO $$
DECLARE
  c RECORD;
BEGIN
  FOR c IN
    SELECT col.table_name
    FROM information_schema.columns col
    JOIN information_schema.tables tb
      ON tb.table_schema = col.table_schema AND tb.table_name = col.table_name
    WHERE col.table_schema = 'public'
      AND col.column_name = 'tenant_id'
      AND col.data_type = 'uuid'
      AND tb.table_type = 'BASE TABLE'
      AND col.table_name <> 'tenants'
      AND NOT EXISTS (
        SELECT 1
        FROM information_schema.table_constraints tc
        JOIN information_schema.key_column_usage kcu
          ON kcu.constraint_name = tc.constraint_name
         AND kcu.table_schema = tc.table_schema
        WHERE tc.table_schema = 'public'
          AND tc.table_name = col.table_name
          AND tc.constraint_type = 'FOREIGN KEY'
          AND kcu.column_name = 'tenant_id'
      )
  LOOP
    EXECUTE format(
      'ALTER TABLE %I ADD CONSTRAINT %I FOREIGN KEY (tenant_id) REFERENCES tenants(id) NOT VALID',
      c.table_name, c.table_name || '_tenant_fk'
    );
  END LOOP;
END $$;

-- 2) VALIDATE every NOT VALID tenant_id → tenants FK.
DO $$
DECLARE
  r RECORD;
BEGIN
  PERFORM set_config('app.platform_admin', '1', true);
  FOR r IN
    SELECT
      c.conrelid::regclass AS table_reg,
      c.conname AS constraint_name
    FROM pg_constraint c
    JOIN pg_class rel ON rel.oid = c.conrelid
    JOIN pg_namespace nsp ON nsp.oid = rel.relnamespace
    JOIN pg_class ref ON ref.oid = c.confrelid
    JOIN pg_namespace refnsp ON refnsp.oid = ref.relnamespace
    WHERE c.contype = 'f'
      AND NOT c.convalidated
      AND nsp.nspname = 'public'
      AND refnsp.nspname = 'public'
      AND ref.relname = 'tenants'
      AND (
        SELECT array_agg(a.attname::text ORDER BY u.ord)
        FROM unnest(c.conkey) WITH ORDINALITY AS u(attnum, ord)
        JOIN pg_attribute a
          ON a.attrelid = c.conrelid AND a.attnum = u.attnum
      ) = ARRAY['tenant_id']::text[]
  LOOP
    EXECUTE format(
      'ALTER TABLE %s VALIDATE CONSTRAINT %I',
      r.table_reg,
      r.constraint_name
    );
  END LOOP;
END $$;

-- 3) Fail closed: zero unvalidated tenant_id → tenants FKs, and every uuid
--    tenant_id base table (except tenants) must have such an FK.
DO $$
DECLARE
  leftover text;
  missing text;
BEGIN
  SELECT string_agg(format('%s.%s', c.conrelid::regclass, c.conname), ', ' ORDER BY 1)
  INTO leftover
  FROM pg_constraint c
  JOIN pg_class rel ON rel.oid = c.conrelid
  JOIN pg_namespace nsp ON nsp.oid = rel.relnamespace
  JOIN pg_class ref ON ref.oid = c.confrelid
  JOIN pg_namespace refnsp ON refnsp.oid = ref.relnamespace
  WHERE c.contype = 'f'
    AND NOT c.convalidated
    AND nsp.nspname = 'public'
    AND refnsp.nspname = 'public'
    AND ref.relname = 'tenants'
    AND (
      SELECT array_agg(a.attname::text ORDER BY u.ord)
      FROM unnest(c.conkey) WITH ORDINALITY AS u(attnum, ord)
      JOIN pg_attribute a
        ON a.attrelid = c.conrelid AND a.attnum = u.attnum
    ) = ARRAY['tenant_id']::text[];

  IF leftover IS NOT NULL THEN
    RAISE EXCEPTION
      'W1-DATA-06: unvalidated tenant_id → tenants FKs remain: %', leftover;
  END IF;

  SELECT string_agg(col.table_name, ', ' ORDER BY col.table_name)
  INTO missing
  FROM information_schema.columns col
  JOIN information_schema.tables tb
    ON tb.table_schema = col.table_schema AND tb.table_name = col.table_name
  WHERE col.table_schema = 'public'
    AND col.column_name = 'tenant_id'
    AND col.data_type = 'uuid'
    AND tb.table_type = 'BASE TABLE'
    AND col.table_name <> 'tenants'
    AND NOT EXISTS (
      SELECT 1
      FROM information_schema.table_constraints tc
      JOIN information_schema.key_column_usage kcu
        ON kcu.constraint_name = tc.constraint_name
       AND kcu.table_schema = tc.table_schema
      WHERE tc.table_schema = 'public'
        AND tc.table_name = col.table_name
        AND tc.constraint_type = 'FOREIGN KEY'
        AND kcu.column_name = 'tenant_id'
    );

  IF missing IS NOT NULL THEN
    RAISE EXCEPTION
      'W1-DATA-06: uuid tenant_id tables missing tenants(id) FK: %', missing;
  END IF;
END $$;

INSERT INTO schema_migrations (filename)
VALUES ('082_repair_strict_tenant_fk_validate.sql')
ON CONFLICT (filename) DO NOTHING;
