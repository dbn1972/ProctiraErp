-- PRC-M285: class sections and institution names relied on app-level
-- duplicate checks only, with no DB unique constraint backing them — a true
-- race (two concurrent creates past the app-level check) could still land
-- two rows in the same logical slot. Add partial unique indexes covering
-- only live (non-soft-deleted) rows, following the same
-- `CREATE UNIQUE INDEX CONCURRENTLY ... WHERE deleted_at IS NULL` pattern
-- already used by `102_outbox_failed_index.sql` / `065_enrollment_active_
-- uniqueness.sql` / `251_institution_soft_delete_partial_unique.sql`.
--
-- No `schema.prisma` change needed: `Class` has no existing `@@unique` on
-- this column set to remove, and `Institution` (name+area) was never
-- declared unique in Prisma either — these are purely additive raw-SQL
-- indexes. Prisma's query engine surfaces any native Postgres `23505`
-- (including ones from indexes it doesn't know about) as `P2002`, and the
-- gateway's global error handler already maps `P2002` to a 409 regardless
-- of whether the constraint is schema-aware, so no app-code catch-block
-- changes are needed beyond the app-level check added in `class-service.ts`.
--
-- Every statement is idempotent compensating-forward DDL (db/README.md);
-- CONCURRENTLY means apply-sql.sh applies this file statement-by-statement
-- via schema_migration_phases, not inside one transaction.

-- Resume safety: drop any INVALID leftover from an interrupted CONCURRENTLY
-- build before rebuilding (plain DROP — Postgres rejects DROP INDEX
-- CONCURRENTLY inside a DO block).
DO $drop_invalid_classes_tenant_inst_grade_period_name$
BEGIN
  IF EXISTS (
    SELECT 1
      FROM pg_class c
      JOIN pg_namespace n ON n.oid = c.relnamespace
      JOIN pg_index i ON i.indexrelid = c.oid
     WHERE n.nspname = 'public'
       AND c.relname = 'idx_classes_tenant_inst_grade_period_name'
       AND NOT i.indisvalid
  ) THEN
    RAISE NOTICE 'dropping invalid idx_classes_tenant_inst_grade_period_name before rebuild';
    EXECUTE 'DROP INDEX IF EXISTS public.idx_classes_tenant_inst_grade_period_name';
  END IF;
END
$drop_invalid_classes_tenant_inst_grade_period_name$;

CREATE UNIQUE INDEX CONCURRENTLY IF NOT EXISTS idx_classes_tenant_inst_grade_period_name
  ON classes (tenant_id, institution_id, grade_id, academic_period_id, name)
  WHERE deleted_at IS NULL;

DO $assert_classes_tenant_inst_grade_period_name$
BEGIN
  IF NOT EXISTS (
    SELECT 1
      FROM pg_class c
      JOIN pg_namespace n ON n.oid = c.relnamespace
      JOIN pg_index i ON i.indexrelid = c.oid
     WHERE n.nspname = 'public'
       AND c.relname = 'idx_classes_tenant_inst_grade_period_name'
       AND i.indisvalid
  ) THEN
    RAISE EXCEPTION
      'PRC-M285: idx_classes_tenant_inst_grade_period_name missing or INVALID';
  END IF;
END
$assert_classes_tenant_inst_grade_period_name$;

DO $drop_invalid_institutions_tenant_area_name$
BEGIN
  IF EXISTS (
    SELECT 1
      FROM pg_class c
      JOIN pg_namespace n ON n.oid = c.relnamespace
      JOIN pg_index i ON i.indexrelid = c.oid
     WHERE n.nspname = 'public'
       AND c.relname = 'idx_institutions_tenant_area_name'
       AND NOT i.indisvalid
  ) THEN
    RAISE NOTICE 'dropping invalid idx_institutions_tenant_area_name before rebuild';
    EXECUTE 'DROP INDEX IF EXISTS public.idx_institutions_tenant_area_name';
  END IF;
END
$drop_invalid_institutions_tenant_area_name$;

CREATE UNIQUE INDEX CONCURRENTLY IF NOT EXISTS idx_institutions_tenant_area_name
  ON institutions (tenant_id, area_id, name)
  WHERE deleted_at IS NULL;

DO $assert_institutions_tenant_area_name$
BEGIN
  IF NOT EXISTS (
    SELECT 1
      FROM pg_class c
      JOIN pg_namespace n ON n.oid = c.relnamespace
      JOIN pg_index i ON i.indexrelid = c.oid
     WHERE n.nspname = 'public'
       AND c.relname = 'idx_institutions_tenant_area_name'
       AND i.indisvalid
  ) THEN
    RAISE EXCEPTION
      'PRC-M285: idx_institutions_tenant_area_name missing or INVALID';
  END IF;
END
$assert_institutions_tenant_area_name$;
