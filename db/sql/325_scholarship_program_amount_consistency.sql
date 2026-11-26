-- PRC-L094: scholarship programme award amount — the major-unit and cents
-- columns must agree.
--
-- 079 added scholarship_programs.amount_per_recipient_cents next to 016's
-- NUMERIC amount_per_recipient and dual-writes both. Nothing in the database
-- kept them equal, so a direct write (or a writer that sets only one side;
-- the cents column defaults to 0) left a programme whose cents value, which
-- the repository reads first, disagreed with the major value shown elsewhere.
--
-- Fix: CHECK (amount_per_recipient * 100 = amount_per_recipient_cents).
-- NUMERIC arithmetic is exact, so the major value must also be a whole
-- number of cents. The service already writes both from one resolved pair
-- (resolveMoneyPair), so application writes are unaffected.
--
-- Existing rows are not changed. A NOT VALID CHECK would still be checked on
-- every later UPDATE of a mismatched legacy row (a slot claim on that
-- programme would then fail at runtime), and which side is right cannot be
-- decided here (rows written after 079 with only the major value carry
-- cents = 0). So a preflight counts mismatched rows and fails the migration
-- with that count, for an operator to reconcile first; with none, the CHECK
-- is VALIDATEd. A database built by the application or the seeds has none.
-- The scan lifts FORCE ROW LEVEL SECURITY for the count and VALIDATE and
-- restores it in the same transaction (the 100/257/319 pattern).
--
-- Rollback (forward migration): ALTER TABLE scholarship_programs DROP
-- CONSTRAINT scholarship_programs_amount_cents_consistent_chk.
ALTER TABLE scholarship_programs
  DROP CONSTRAINT IF EXISTS scholarship_programs_amount_cents_consistent_chk;
ALTER TABLE scholarship_programs
  ADD CONSTRAINT scholarship_programs_amount_cents_consistent_chk
  CHECK (amount_per_recipient * 100 = amount_per_recipient_cents) NOT VALID;
DO $l094$
DECLARE
  was_forced boolean;
  mismatched bigint;
BEGIN
  SELECT relforcerowsecurity INTO was_forced
    FROM pg_class WHERE oid = 'public.scholarship_programs'::regclass;
  IF was_forced THEN
    ALTER TABLE scholarship_programs NO FORCE ROW LEVEL SECURITY;
  END IF;
  SELECT count(*) INTO mismatched
    FROM scholarship_programs
   WHERE amount_per_recipient * 100 <> amount_per_recipient_cents;
  IF mismatched > 0 THEN
    RAISE EXCEPTION
      'PRC-L094: % scholarship_programs row(s) have amount_per_recipient * 100 <> amount_per_recipient_cents; '
      'reconcile them before re-running',
      mismatched;
  END IF;
  ALTER TABLE scholarship_programs
    VALIDATE CONSTRAINT scholarship_programs_amount_cents_consistent_chk;
  IF was_forced THEN
    ALTER TABLE scholarship_programs FORCE ROW LEVEL SECURITY;
  END IF;
END
$l094$;
INSERT INTO schema_migrations (filename)
VALUES ('325_scholarship_program_amount_consistency.sql')
ON CONFLICT (filename) DO NOTHING;
