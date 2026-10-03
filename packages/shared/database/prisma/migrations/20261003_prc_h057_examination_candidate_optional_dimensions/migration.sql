-- PRC-H057 (Prisma layer): examination_candidates.gender / area_id become optional.
--
-- Result publication used to synthesise gender = 'other' and area_id = center_id
-- when the real value was unknown, which corrupted gender/area analysis. NULL now
-- means "unknown". DROP NOT NULL is metadata-only (no rewrite, brief lock) and is
-- safe on existing data: every existing row keeps its value. Idempotent.
--
-- Rollback: forward-only. Re-adding NOT NULL needs a backfill of every NULL first.
ALTER TABLE "examination_candidates"
  ALTER COLUMN "gender" DROP NOT NULL;
ALTER TABLE "examination_candidates"
  ALTER COLUMN "area_id" DROP NOT NULL;
