-- PRC-L555: grading_scale_bands (003) only checked min_percent <= max_percent,
-- so one grading scale could carry overlapping bands and a percentage could
-- map to two grades. (The seed fix for the board scales already landed in
-- db/seeds/003_sis_timetable_board_scales.sql, PRC-L555 E1/E2.)
--
--   grading_scale_bands_no_overlap_excl EXCLUDE USING gist (
--     grading_scale_id WITH =, numrange(min_percent, max_percent, '[]') WITH &&)
--
-- Bands are closed intervals (gradebook maps a score equal to max_percent into
-- the band), so touching bands overlap and contiguous bands must be written as
-- e.g. 0-39.99 / 40-100. Verified before writing this file: every band seeded
-- by db/seeds/002, 003 and 006 (30 bands, 4 scales) has zero '[]' overlaps,
-- and no application path writes grading_scale_bands (gradebook only reads).
-- Gap/coverage rules (contiguity granularity, [0,100] coverage per board) are
-- a statutory board-scale rule and are NOT enforced here (BLOCKED_FOR_APPROVAL).
--
-- btree_gist provides gist equality for uuid (already created by 248; repeated
-- idempotently). Postgres has no NOT VALID for EXCLUDE, so the ADD is a
-- blocking (ACCESS EXCLUSIVE) build: waived in
-- tools/scripts/migration-ddl-hazard-waiver.json (small reference table). The
-- preflight lifts FORCE RLS for the owner scan and restores it in the same
-- block (this file runs in one transaction) and refuses to add the constraint
-- over existing overlaps (never deletes data).
--
-- Invariant: within one grading_scale_id, no two bands share any percentage.
-- Rollback (future forward migration):
--   ALTER TABLE grading_scale_bands DROP CONSTRAINT IF EXISTS grading_scale_bands_no_overlap_excl;
CREATE EXTENSION IF NOT EXISTS btree_gist;
DO $l555_preflight$
DECLARE
  was_forced boolean;
  overlap_count bigint;
BEGIN
  SELECT relforcerowsecurity INTO was_forced FROM pg_class WHERE oid = 'public.grading_scale_bands'::regclass;
  IF was_forced THEN
    ALTER TABLE grading_scale_bands NO FORCE ROW LEVEL SECURITY;
  END IF;
  SELECT count(*) INTO overlap_count
    FROM grading_scale_bands a
    JOIN grading_scale_bands b
      ON a.grading_scale_id = b.grading_scale_id
     AND a.id < b.id
     AND numrange(a.min_percent, a.max_percent, '[]') && numrange(b.min_percent, b.max_percent, '[]');
  IF was_forced THEN
    ALTER TABLE grading_scale_bands FORCE ROW LEVEL SECURITY;
  END IF;
  IF overlap_count > 0 THEN
    RAISE EXCEPTION
      'PRC-L555: % overlapping grading_scale_bands pair(s) exist; fix the band ranges before re-running',
      overlap_count;
  END IF;
END
$l555_preflight$;
ALTER TABLE grading_scale_bands DROP CONSTRAINT IF EXISTS grading_scale_bands_no_overlap_excl;
ALTER TABLE grading_scale_bands
  ADD CONSTRAINT grading_scale_bands_no_overlap_excl
  EXCLUDE USING gist (
    grading_scale_id WITH =,
    numrange(min_percent, max_percent, '[]') WITH &&
  );
