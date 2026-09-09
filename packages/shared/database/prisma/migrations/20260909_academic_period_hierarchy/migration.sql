-- Migration: G-905 academic calendar — year → term hierarchy on academic_periods.
-- Additive and idempotent; db/sql/030_academic_calendar_schema.sql carries the
-- same ALTERs for raw-SQL setups that do not run Prisma migrate.

ALTER TABLE "academic_periods"
  ADD COLUMN IF NOT EXISTS "kind" VARCHAR(20) NOT NULL DEFAULT 'year';

ALTER TABLE "academic_periods"
  ADD COLUMN IF NOT EXISTS "parent_id" UUID;

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint WHERE conname = 'academic_periods_parent_id_fkey'
  ) THEN
    ALTER TABLE "academic_periods"
      ADD CONSTRAINT "academic_periods_parent_id_fkey"
      FOREIGN KEY ("parent_id") REFERENCES "academic_periods"("id")
      ON DELETE SET NULL ON UPDATE CASCADE;
  END IF;
END $$;

CREATE INDEX IF NOT EXISTS "academic_periods_tenant_id_parent_id_idx"
  ON "academic_periods"("tenant_id", "parent_id");
