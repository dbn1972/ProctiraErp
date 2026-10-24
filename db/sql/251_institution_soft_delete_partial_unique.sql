-- PRC-L127: `institutions` currently carries a plain
-- `@@unique([tenantId, code])` (Prisma-declared, `institutions_tenant_id_code_key`).
-- No app path sets `deleted_at` on institutions today, so this is not yet an
-- observed bug, but the plain unique constraint would pre-empt re-using a
-- code once soft-delete lands: a soft-deleted row still occupies the
-- (tenant_id, code) slot, blocking a legitimate re-create with the same code.
--
-- Replace the plain unique constraint with a partial unique index that only
-- considers live rows, then drop the now-redundant constraint. Every
-- statement is idempotent compensating-forward DDL (db/README.md); this file
-- uses CREATE INDEX CONCURRENTLY, so apply-sql.sh applies it statement-by-
-- statement via schema_migration_phases, not inside one transaction.

-- Resume safety: a CONCURRENTLY build interrupted mid-way leaves an INVALID
-- index behind, which IF NOT EXISTS would then skip forever. Drop any invalid
-- leftover before rebuilding (plain DROP — Postgres rejects DROP INDEX
-- CONCURRENTLY inside a DO block).
DO $drop_invalid_institutions_tenant_code_active$
BEGIN
  IF EXISTS (
    SELECT 1
      FROM pg_class c
      JOIN pg_namespace n ON n.oid = c.relnamespace
      JOIN pg_index i ON i.indexrelid = c.oid
     WHERE n.nspname = 'public'
       AND c.relname = 'idx_institutions_tenant_code_active'
       AND NOT i.indisvalid
  ) THEN
    RAISE NOTICE 'dropping invalid idx_institutions_tenant_code_active before rebuild';
    EXECUTE 'DROP INDEX IF EXISTS public.idx_institutions_tenant_code_active';
  END IF;
END
$drop_invalid_institutions_tenant_code_active$;

CREATE UNIQUE INDEX CONCURRENTLY IF NOT EXISTS idx_institutions_tenant_code_active
  ON institutions (tenant_id, code)
  WHERE deleted_at IS NULL;

DO $assert_institutions_tenant_code_active$
BEGIN
  IF NOT EXISTS (
    SELECT 1
      FROM pg_class c
      JOIN pg_namespace n ON n.oid = c.relnamespace
      JOIN pg_index i ON i.indexrelid = c.oid
     WHERE n.nspname = 'public'
       AND c.relname = 'idx_institutions_tenant_code_active'
       AND i.indisvalid
  ) THEN
    RAISE EXCEPTION
      'PRC-L127: idx_institutions_tenant_code_active missing or INVALID';
  END IF;
END
$assert_institutions_tenant_code_active$;

-- Drop the now-redundant plain unique constraint (and its backing index).
-- Dropping a constraint takes a brief ACCESS EXCLUSIVE lock; the replacement
-- partial index above is already built and valid by this point, so there is
-- no window with no duplicate protection — only a window with both.
ALTER TABLE institutions DROP CONSTRAINT IF EXISTS institutions_tenant_id_code_key;

DO $assert_institutions_plain_unique_dropped$
BEGIN
  IF EXISTS (
    SELECT 1 FROM pg_constraint
     WHERE conrelid = 'public.institutions'::regclass
       AND conname = 'institutions_tenant_id_code_key'
  ) THEN
    RAISE EXCEPTION
      'PRC-L127: institutions_tenant_id_code_key should have been dropped';
  END IF;
END
$assert_institutions_plain_unique_dropped$;
