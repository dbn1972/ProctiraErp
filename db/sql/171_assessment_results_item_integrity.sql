-- PRC-M161: a result's subject/period must be its assessment item's subject/period.
--
-- NEEDS DB REVIEW.
--
-- ResultService derives subject_id/academic_period_id from the item, but nothing in the
-- database stopped a mis-tagged row. This adds a composite FK
--   assessment_results (tenant_id, assessment_item_id, subject_id, academic_period_id)
--     -> assessment_items (tenant_id, id, subject_id, academic_period_id)
-- so a result can only carry its own item's subject/period (and only for an item of the
-- same tenant). ON UPDATE CASCADE keeps results aligned if an item is re-tagged.
--
-- Non-transactional file: the FK target unique index on the existing items table is built
-- CONCURRENTLY (online). The FK is added NOT VALID (new writes checked immediately);
-- 172 validates existing rows. Idempotent (apply-sql.sh phase ledger).
-- Rollback: forward-only; DROP CONSTRAINT assessment_results_item_subject_period_fk.
DO $m161_drop_invalid$
BEGIN
  IF EXISTS (
    SELECT 1
      FROM pg_class c
      JOIN pg_namespace n ON n.oid = c.relnamespace
      JOIN pg_index i ON i.indexrelid = c.oid
     WHERE n.nspname = 'public'
       AND c.relname = 'assessment_items_tenant_subject_period_uidx'
       AND NOT i.indisvalid
  ) THEN
    EXECUTE 'DROP INDEX IF EXISTS public.assessment_items_tenant_subject_period_uidx';
  END IF;
END
$m161_drop_invalid$;
CREATE UNIQUE INDEX CONCURRENTLY IF NOT EXISTS assessment_items_tenant_subject_period_uidx
  ON assessment_items (tenant_id, id, subject_id, academic_period_id);
DO $m161_fk$
BEGIN
  IF NOT EXISTS (
    SELECT 1
      FROM pg_class c
      JOIN pg_namespace n ON n.oid = c.relnamespace
      JOIN pg_index i ON i.indexrelid = c.oid
     WHERE n.nspname = 'public'
       AND c.relname = 'assessment_items_tenant_subject_period_uidx'
       AND i.indisvalid
  ) THEN
    RAISE EXCEPTION 'PRC-M161: assessment_items_tenant_subject_period_uidx missing or INVALID';
  END IF;
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint
     WHERE conname = 'assessment_results_item_subject_period_fk'
       AND conrelid = 'public.assessment_results'::regclass
  ) THEN
    ALTER TABLE assessment_results
      ADD CONSTRAINT assessment_results_item_subject_period_fk
      FOREIGN KEY (tenant_id, assessment_item_id, subject_id, academic_period_id)
      REFERENCES assessment_items (tenant_id, id, subject_id, academic_period_id)
      ON UPDATE CASCADE
      NOT VALID;
  END IF;
END
$m161_fk$;
