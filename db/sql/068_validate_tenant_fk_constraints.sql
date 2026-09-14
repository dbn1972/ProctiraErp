-- W1-DATA-06 — VALIDATE tenant_id → tenants(id) foreign keys.
--
-- 021b adds FKs as NOT VALID so existing rows are not scanned at ADD time.
-- Production / staging / primary CI (APPLY_STRICT_FKS=1) must VALIDATE so
-- orphan tenant_id values cannot linger forever.
--
-- Idempotent: only NOT VALID FKs whose sole key column is tenant_id and whose
-- referenced table is tenants are validated. Safe no-op when 021b was skipped.

DO $$
DECLARE
  r RECORD;
BEGIN
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

INSERT INTO schema_migrations (filename)
VALUES ('068_validate_tenant_fk_constraints.sql')
ON CONFLICT (filename) DO NOTHING;
