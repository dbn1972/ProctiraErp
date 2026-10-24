-- PRC-M213: academic_periods_reject_overlap() / fee_structures_reject_overlap()
-- (db/sql/083) are SELECT-then-raise BEFORE triggers: a transaction reads the
-- table for conflicts, finds none, and only the final INSERT/UPDATE's own row
-- lock prevents a conflict -- two concurrent transactions each inserting a
-- distinct non-conflicting-with-itself-but-mutually-overlapping window can
-- both pass the SELECT check before either commits, landing two overlapping
-- active versions. An EXCLUDE USING gist constraint is enforced by Postgres
-- itself at commit time (effectively via index conflict detection), closing
-- that race.
--
-- CREATE EXTENSION IF NOT EXISTS btree_gist is required because the
-- equality operands (tenant_id, code) are not natively gist-indexable;
-- btree_gist adds gist support for ordinary btree-indexable types so they can
-- be combined with the gist-native daterange `&&` operator in one exclusion
-- constraint.
--
-- Predicates mirror 083's trigger functions exactly:
--   academic_periods_reject_overlap(): tenant_id + code match, excluding
--     deleted_at IS NOT NULL rows, overlapping daterange(valid_from, valid_to, '[]').
--   fee_structures_reject_overlap(): tenant_id + code match, excluding
--     status<>'active' rows (i.e. only 'active' rows participate), overlapping
--     daterange(valid_from, COALESCE(valid_to, '9999-12-31'), '[]') semantics --
--     expressed here as daterange(valid_from, valid_to, '[]') with valid_to
--     NULL meaning open-ended, which Postgres's daterange already treats as
--     unbounded upper (equivalent overlap semantics to the trigger's explicit
--     9999-12-31 substitution).
--
-- Postgres has no NOT VALID option for ADD CONSTRAINT ... EXCLUDE, so this is
-- a genuine blocking (ACCESS EXCLUSIVE for the duration of the add+validate)
-- operation -- waived in tools/scripts/migration-ddl-hazard-waiver.json
-- (both tables are small per-tenant reference catalogs, not transactional
-- volume, so the lock window is brief). A live preflight (below) refuses to
-- add either constraint over pre-existing overlapping data.
--
-- After both EXCLUDE constraints are confirmed present and valid, the now-
-- redundant SELECT-check triggers/functions are dropped. The DATE immutability
-- triggers (trg_academic_periods_dates_immutable / trg_fee_structures_effective_immutable)
-- guard a different invariant (append-only versioning) and are left untouched.
--
-- Rollback: forward-only; a later migration may DROP these EXCLUDE constraints
-- and reinstate the trigger functions from 083 if ever needed.

CREATE EXTENSION IF NOT EXISTS btree_gist;

-- 1) Preflight: refuse to add either EXCLUDE constraint over pre-existing
--    overlapping data. Lift FORCE RLS for the owner scan and restore it in
--    the same block.
DO $m213_preflight$
DECLARE
  was_forced boolean;
  overlap_count bigint;
BEGIN
  SELECT relforcerowsecurity INTO was_forced
    FROM pg_class WHERE oid = 'public.academic_periods'::regclass;
  IF was_forced THEN
    ALTER TABLE academic_periods NO FORCE ROW LEVEL SECURITY;
  END IF;

  SELECT count(*) INTO overlap_count
    FROM academic_periods a
    JOIN academic_periods b
      ON a.tenant_id = b.tenant_id
     AND a.code = b.code
     AND a.id < b.id
     AND a.deleted_at IS NULL
     AND b.deleted_at IS NULL
     AND daterange(a.valid_from, a.valid_to, '[]') && daterange(b.valid_from, b.valid_to, '[]');

  IF was_forced THEN
    ALTER TABLE academic_periods FORCE ROW LEVEL SECURITY;
  END IF;

  IF overlap_count > 0 THEN
    RAISE EXCEPTION
      'PRC-M213: % academic_periods overlapping pair(s) already exist; reconcile before re-running',
      overlap_count;
  END IF;

  SELECT relforcerowsecurity INTO was_forced
    FROM pg_class WHERE oid = 'public.fee_structures'::regclass;
  IF was_forced THEN
    ALTER TABLE fee_structures NO FORCE ROW LEVEL SECURITY;
  END IF;

  SELECT count(*) INTO overlap_count
    FROM fee_structures a
    JOIN fee_structures b
      ON a.tenant_id = b.tenant_id
     AND a.code = b.code
     AND a.id < b.id
     AND a.status = 'active'
     AND b.status = 'active'
     AND daterange(a.valid_from, a.valid_to, '[]') && daterange(b.valid_from, b.valid_to, '[]');

  IF was_forced THEN
    ALTER TABLE fee_structures FORCE ROW LEVEL SECURITY;
  END IF;

  IF overlap_count > 0 THEN
    RAISE EXCEPTION
      'PRC-M213: % fee_structures overlapping pair(s) already exist; reconcile before re-running',
      overlap_count;
  END IF;
END
$m213_preflight$;

-- 2) The EXCLUDE constraints (blocking; waived -- see
--    tools/scripts/migration-ddl-hazard-waiver.json).
ALTER TABLE academic_periods DROP CONSTRAINT IF EXISTS academic_periods_no_overlap_excl;
ALTER TABLE academic_periods
  ADD CONSTRAINT academic_periods_no_overlap_excl
  EXCLUDE USING gist (
    tenant_id WITH =,
    code WITH =,
    daterange(valid_from, valid_to, '[]') WITH &&
  )
  WHERE (deleted_at IS NULL);

ALTER TABLE fee_structures DROP CONSTRAINT IF EXISTS fee_structures_no_overlap_excl;
ALTER TABLE fee_structures
  ADD CONSTRAINT fee_structures_no_overlap_excl
  EXCLUDE USING gist (
    tenant_id WITH =,
    code WITH =,
    daterange(valid_from, valid_to, '[]') WITH &&
  )
  WHERE (status = 'active');

-- 3) Assert both constraints are present and valid before dropping the
--    redundant SELECT-check triggers -- a failed add above would have
--    aborted the transaction already, but this also guards against a
--    previous partial/legacy state.
DO $m213_assert$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint WHERE conname = 'academic_periods_no_overlap_excl'
  ) THEN
    RAISE EXCEPTION 'PRC-M213: academic_periods_no_overlap_excl missing';
  END IF;
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint WHERE conname = 'fee_structures_no_overlap_excl'
  ) THEN
    RAISE EXCEPTION 'PRC-M213: fee_structures_no_overlap_excl missing';
  END IF;
END
$m213_assert$;

-- 4) Drop the now-redundant race-prone SELECT-check triggers/functions. The
--    date-immutability triggers (a different invariant) are untouched.
DROP TRIGGER IF EXISTS trg_academic_periods_reject_overlap ON academic_periods;
DROP FUNCTION IF EXISTS academic_periods_reject_overlap();

DROP TRIGGER IF EXISTS trg_fee_structures_reject_overlap ON fee_structures;
DROP FUNCTION IF EXISTS fee_structures_reject_overlap();

INSERT INTO schema_migrations (filename)
VALUES ('248_academic_fee_overlap_exclusion.sql')
ON CONFLICT (filename) DO NOTHING;
