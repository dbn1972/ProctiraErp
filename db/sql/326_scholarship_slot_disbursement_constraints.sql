-- PRC-M197: scholarship slot and disbursement-amount constraints, INR
-- default currency.
--
-- Residuals after #632 (D1 money model) and 108 (one on-approval
-- disbursement per application):
--   * scholarship_programs.currency still defaulted to 'USD' in the database
--     (016); D1 sets INR as the default and adds no per-tenant setting.
--   * used_slots could exceed total_slots: only the slot claim's conditional
--     UPDATE (used_slots < total_slots) held the line, and a programme edit
--     could lower total_slots below the slots already used.
--   * scholarship_disbursements.amount (NUMERIC major) and amount_cents (060)
--     were dual-written with no consistency rule.
--   * nothing stopped a second live application from one applicant to one
--     programme; 327 adds that unique index (online, non-transactional).
--
-- Fix:
--   1. currency DEFAULT 'INR' (existing rows keep their stored currency).
--   2. CHECK (used_slots <= total_slots).
--   3. CHECK (amount * 100 = amount_cents) on scholarship_disbursements.
--   Both CHECKs are added NOT VALID, then a preflight (FORCE ROW LEVEL
--   SECURITY lifted and restored in this transaction) counts violating rows.
--   A NOT VALID CHECK would still fire on every later UPDATE of a violating
--   row, so instead of leaving those rows to fail at runtime the migration
--   stops with the counts for an operator to reconcile; with none, both CHECKs
--   are VALIDATEd. No row is changed.
--
-- The service now refuses (409) a programme edit that lowers total_slots below
-- used_slots, so that edit no longer reaches the CHECK.
--
-- Rollback (forward migration): drop the two constraints; SET DEFAULT 'USD'
-- would restore 016's default.
ALTER TABLE scholarship_programs ALTER COLUMN currency SET DEFAULT 'INR';
ALTER TABLE scholarship_programs
  DROP CONSTRAINT IF EXISTS scholarship_programs_used_slots_within_total_chk;
ALTER TABLE scholarship_programs
  ADD CONSTRAINT scholarship_programs_used_slots_within_total_chk
  CHECK (used_slots <= total_slots) NOT VALID;
ALTER TABLE scholarship_disbursements
  DROP CONSTRAINT IF EXISTS scholarship_disbursements_amount_cents_consistent_chk;
ALTER TABLE scholarship_disbursements
  ADD CONSTRAINT scholarship_disbursements_amount_cents_consistent_chk
  CHECK (amount * 100 = amount_cents) NOT VALID;
DO $m197$
DECLARE
  programs_forced boolean;
  disbursements_forced boolean;
  over_slots bigint;
  mismatched bigint;
BEGIN
  SELECT relforcerowsecurity INTO programs_forced
    FROM pg_class WHERE oid = 'public.scholarship_programs'::regclass;
  SELECT relforcerowsecurity INTO disbursements_forced
    FROM pg_class WHERE oid = 'public.scholarship_disbursements'::regclass;
  IF programs_forced THEN
    ALTER TABLE scholarship_programs NO FORCE ROW LEVEL SECURITY;
  END IF;
  IF disbursements_forced THEN
    ALTER TABLE scholarship_disbursements NO FORCE ROW LEVEL SECURITY;
  END IF;
  SELECT count(*) INTO over_slots FROM scholarship_programs WHERE used_slots > total_slots;
  SELECT count(*) INTO mismatched
    FROM scholarship_disbursements WHERE amount * 100 <> amount_cents;
  IF over_slots > 0 OR mismatched > 0 THEN
    RAISE EXCEPTION
      'PRC-M197: % scholarship_programs row(s) have used_slots > total_slots and % '
      'scholarship_disbursements row(s) have amount * 100 <> amount_cents; reconcile them before re-running',
      over_slots, mismatched;
  END IF;
  ALTER TABLE scholarship_programs
    VALIDATE CONSTRAINT scholarship_programs_used_slots_within_total_chk;
  ALTER TABLE scholarship_disbursements
    VALIDATE CONSTRAINT scholarship_disbursements_amount_cents_consistent_chk;
  IF programs_forced THEN
    ALTER TABLE scholarship_programs FORCE ROW LEVEL SECURITY;
  END IF;
  IF disbursements_forced THEN
    ALTER TABLE scholarship_disbursements FORCE ROW LEVEL SECURITY;
  END IF;
END
$m197$;
INSERT INTO schema_migrations (filename)
VALUES ('326_scholarship_slot_disbursement_constraints.sql')
ON CONFLICT (filename) DO NOTHING;
