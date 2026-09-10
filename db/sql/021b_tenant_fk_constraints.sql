-- Wave 7 (G-718) — tenant_id → tenants(id) foreign keys (opt-in).
--
-- Adds a NOT VALID FK from every UUID tenant_id column to tenants(id) where one
-- is missing. NOT VALID skips validation of existing rows; new rows are checked.
--
-- Opt-in: tools/scripts/apply-sql.sh applies this file only when
-- APPLY_STRICT_FKS=1, because unit/integration fixtures insert rows under ad-hoc
-- tenant ids. Production / staging should run with APPLY_STRICT_FKS=1.
--
-- Validate later with:  ALTER TABLE <t> VALIDATE CONSTRAINT <t>_tenant_fk;

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

INSERT INTO schema_migrations (filename)
VALUES ('021b_tenant_fk_constraints.sql')
ON CONFLICT (filename) DO NOTHING;
