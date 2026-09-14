-- W3-TIME-01 / B4 — tenant timezone foundation (Prisma layer)

ALTER TABLE "tenants"
  ADD COLUMN IF NOT EXISTS "timezone" VARCHAR(64);

UPDATE "tenants"
SET "timezone" = COALESCE(
  NULLIF(trim("config" #>> '{locale,timezone}'), ''),
  NULLIF(trim("config" ->> 'timezone'), ''),
  'UTC'
)
WHERE "timezone" IS NULL;

ALTER TABLE "tenants"
  ALTER COLUMN "timezone" SET DEFAULT 'UTC';

ALTER TABLE "tenants"
  ALTER COLUMN "timezone" SET NOT NULL;
