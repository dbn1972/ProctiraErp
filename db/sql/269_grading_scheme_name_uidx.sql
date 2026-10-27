-- PRC-L082: grading_schemes (Prisma authority, 20260612 migration) has only
-- non-unique @@index([tenantId, name]). AssessmentService.createGradingScheme /
-- updateGradingScheme check findByName (case-insensitive: Prisma
-- mode 'insensitive'; in-memory toLowerCase) and then write, so two concurrent
-- creates of "Term" and "term" both land.
--
--   grading_schemes_tenant_lower_name_uidx (tenant_id, lower(name))
--
-- mirrors the app rule exactly (per tenant, case-insensitive). Raw-SQL extra
-- unique index on a Prisma-modelled table, same as 253 on classes/institutions:
-- Prisma does not model expression indexes, and the drift gate
-- (check:prisma-sql-drift) passes with it. Prisma surfaces the 23505 as P2002;
-- PrismaGradingSchemeRepository maps it to ConflictError (409).
--
-- Shape (246/253): preflight duplicate count with FORCE RLS lifted and restored
-- inside one DO block, RAISE on duplicates (never delete data); drop an INVALID
-- leftover; CREATE UNIQUE INDEX CONCURRENTLY IF NOT EXISTS; assert valid +
-- unique. Every statement is idempotent; applied statement-by-statement via
-- schema_migration_phases.
-- Rollback (future forward migration):
--   DROP INDEX IF EXISTS grading_schemes_tenant_lower_name_uidx;
DO $l082_preflight$
DECLARE
  was_forced boolean;
  duplicate_groups bigint;
BEGIN
  SELECT relforcerowsecurity INTO was_forced FROM pg_class WHERE oid = 'public.grading_schemes'::regclass;
  IF was_forced THEN
    ALTER TABLE grading_schemes NO FORCE ROW LEVEL SECURITY;
  END IF;
  SELECT count(*) INTO duplicate_groups
    FROM (
      SELECT tenant_id, lower(name) FROM grading_schemes
       GROUP BY tenant_id, lower(name)
      HAVING count(*) > 1
    ) d;
  IF was_forced THEN
    ALTER TABLE grading_schemes FORCE ROW LEVEL SECURITY;
  END IF;
  IF duplicate_groups > 0 THEN
    RAISE EXCEPTION
      'PRC-L082: % case-insensitive duplicate grading_schemes name group(s) exist; rename before re-running',
      duplicate_groups;
  END IF;
END
$l082_preflight$;
DO $l082_drop_invalid$
BEGIN
  IF EXISTS (
    SELECT 1
      FROM pg_class c
      JOIN pg_namespace n ON n.oid = c.relnamespace
      JOIN pg_index i ON i.indexrelid = c.oid
     WHERE n.nspname = 'public'
       AND c.relname = 'grading_schemes_tenant_lower_name_uidx'
       AND NOT i.indisvalid
  ) THEN
    RAISE NOTICE 'dropping invalid grading_schemes_tenant_lower_name_uidx before rebuild';
    EXECUTE 'DROP INDEX IF EXISTS public.grading_schemes_tenant_lower_name_uidx';
  END IF;
END
$l082_drop_invalid$;
CREATE UNIQUE INDEX CONCURRENTLY IF NOT EXISTS grading_schemes_tenant_lower_name_uidx
  ON grading_schemes (tenant_id, lower(name));
DO $l082_assert$
BEGIN
  IF NOT EXISTS (
    SELECT 1
      FROM pg_class c
      JOIN pg_namespace n ON n.oid = c.relnamespace
      JOIN pg_index i ON i.indexrelid = c.oid
     WHERE n.nspname = 'public'
       AND c.relname = 'grading_schemes_tenant_lower_name_uidx'
       AND i.indisvalid
       AND i.indisunique
  ) THEN
    RAISE EXCEPTION 'PRC-L082: grading_schemes_tenant_lower_name_uidx missing or INVALID';
  END IF;
END
$l082_assert$;
