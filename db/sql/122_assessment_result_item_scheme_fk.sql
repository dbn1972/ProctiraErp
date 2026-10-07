-- PRC-H037: referential integrity for assessment grading.
--
-- assessment_results.assessment_item_id and assessment_items.grading_scheme_id
-- were referenced only "by convention" — no FK existed. That let:
--   * item replace (delete+recreate with new ids) orphan every result, and
--   * a grading scheme delete leave items pointing at a missing scheme (grade
--     calc then throws NotFound and subjects silently drop from report cards).
--
-- The service now guards both operations (block when results/items exist); this
-- migration is the DB backstop: ON DELETE RESTRICT so Postgres refuses a delete
-- that would orphan a child row.
--
-- These are Prisma FORCE-RLS tables, so (per db/sql/087) we ADD … NOT VALID
-- only: new INSERT/UPDATE reject dangling parent UUIDs immediately, while a full
-- VALIDATE scan (which cannot see cross-tenant rows under FORCE RLS) stays an
-- operator task after any orphan cleanup. Additive and idempotent: skips when
-- the constraint exists or the column already has a FK.
--
-- Rollback: forward-only; a later migration may drop the constraints to relax.

DO $$ BEGIN
  PERFORM set_config('app.platform_admin', '1', true);
END $$;

DO $$
DECLARE
  r RECORD;
BEGIN
  FOR r IN
    SELECT *
    FROM (
      VALUES
        ('assessment_results', 'assessment_item_id',
         'assessment_results_assessment_item_id_fkey',
         'FOREIGN KEY (assessment_item_id) REFERENCES assessment_items(id) ON DELETE RESTRICT'),
        ('assessment_items', 'grading_scheme_id',
         'assessment_items_grading_scheme_id_fkey',
         'FOREIGN KEY (grading_scheme_id) REFERENCES grading_schemes(id) ON DELETE RESTRICT')
    ) AS t(table_name, column_name, constraint_name, def)
  LOOP
    IF to_regclass('public.' || r.table_name) IS NULL THEN
      RAISE NOTICE 'PRC-H037: skip % (table missing)', r.constraint_name;
      CONTINUE;
    END IF;

    IF NOT EXISTS (
      SELECT 1
      FROM information_schema.columns c
      WHERE c.table_schema = 'public'
        AND c.table_name = r.table_name
        AND c.column_name = r.column_name
    ) THEN
      RAISE NOTICE 'PRC-H037: skip % (column missing)', r.constraint_name;
      CONTINUE;
    END IF;

    IF EXISTS (
      SELECT 1
      FROM pg_constraint c
      JOIN pg_class rel ON rel.oid = c.conrelid
      JOIN pg_namespace nsp ON nsp.oid = rel.relnamespace
      WHERE nsp.nspname = 'public'
        AND rel.relname = r.table_name
        AND c.conname = r.constraint_name
    ) THEN
      CONTINUE;
    END IF;

    IF EXISTS (
      SELECT 1
      FROM information_schema.table_constraints tc
      JOIN information_schema.key_column_usage kcu
        ON kcu.constraint_name = tc.constraint_name
       AND kcu.table_schema = tc.table_schema
       AND kcu.table_name = tc.table_name
      WHERE tc.table_schema = 'public'
        AND tc.table_name = r.table_name
        AND tc.constraint_type = 'FOREIGN KEY'
        AND kcu.column_name = r.column_name
    ) THEN
      RAISE NOTICE 'PRC-H037: skip % (column already has FK)', r.constraint_name;
      CONTINUE;
    END IF;

    EXECUTE format(
      'ALTER TABLE %I ADD CONSTRAINT %I %s NOT VALID',
      r.table_name,
      r.constraint_name,
      r.def
    );
  END LOOP;
END $$;

INSERT INTO schema_migrations (filename)
VALUES ('122_assessment_result_item_scheme_fk.sql')
ON CONFLICT (filename) DO NOTHING;
