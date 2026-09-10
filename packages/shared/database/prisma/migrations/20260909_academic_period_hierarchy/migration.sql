-- Migration: G-905 academic calendar — year → term hierarchy on academic_periods.
-- Additive and idempotent; db/sql/030_academic_calendar_schema.sql carries the
-- same ALTERs for raw-SQL setups that do not run Prisma migrate.
--
-- `academic_periods` itself is created by db/sql/001 (not by a Prisma
-- migration), and CI runs `prisma migrate deploy` before `apply-sql.sh`. On an
-- empty database the table does not exist yet, so every statement is guarded;
-- db/sql/030 then applies the identical columns/constraint/index.

DO $$
BEGIN
  IF to_regclass('public.academic_periods') IS NULL THEN
    RAISE NOTICE 'academic_periods not present yet; db/sql/030 will add the hierarchy columns';
    RETURN;
  END IF;

  ALTER TABLE "academic_periods"
    ADD COLUMN IF NOT EXISTS "kind" VARCHAR(20) NOT NULL DEFAULT 'year';

  ALTER TABLE "academic_periods"
    ADD COLUMN IF NOT EXISTS "parent_id" UUID;

  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint WHERE conname = 'academic_periods_parent_id_fkey'
  ) THEN
    ALTER TABLE "academic_periods"
      ADD CONSTRAINT "academic_periods_parent_id_fkey"
      FOREIGN KEY ("parent_id") REFERENCES "academic_periods"("id")
      ON DELETE SET NULL ON UPDATE CASCADE;
  END IF;

  CREATE INDEX IF NOT EXISTS "academic_periods_tenant_id_parent_id_idx"
    ON "academic_periods"("tenant_id", "parent_id");
END $$;
