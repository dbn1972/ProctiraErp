-- PRC-M201: payroll ledger journals must balance.
--
-- 245 made staff_payroll_lines and staff_payroll_ledger_entries append-only,
-- but nothing in the database checked that a payroll journal balances: a
-- one-legged or short journal committed. The fee ledger has had this check
-- since 023 (fee_ledger_journal_balanced). DR37 (owner rule, 2026-10-27) says
-- payroll journals must balance or posting is refused.
--
-- Fix: a DEFERRABLE INITIALLY DEFERRED constraint trigger, the 023 pattern.
-- At COMMIT it sums the debit and credit legs of each (tenant_id, journal_id)
-- that the transaction inserted into, and raises 23000 when they differ, so
-- the whole transaction rolls back. Legs are append-only (245), so INSERT is
-- the only event that can change a journal's totals.
--
-- Existing rows are not touched or re-checked. No runtime path writes this
-- table yet (the payroll export keeps its trial balance on the run row), so
-- a database built from scratch has no rows here.
--
-- Rollback (forward migration): DROP TRIGGER
-- trg_staff_payroll_ledger_journal_balanced ON staff_payroll_ledger_entries;
-- DROP FUNCTION staff_payroll_ledger_journal_balanced().
CREATE OR REPLACE FUNCTION staff_payroll_ledger_journal_balanced() RETURNS trigger AS $$
DECLARE
  debits  BIGINT;
  credits BIGINT;
BEGIN
  SELECT COALESCE(SUM(CASE WHEN side = 'debit'  THEN amount_cents END), 0),
         COALESCE(SUM(CASE WHEN side = 'credit' THEN amount_cents END), 0)
    INTO debits, credits
    FROM staff_payroll_ledger_entries
   WHERE journal_id = NEW.journal_id AND tenant_id = NEW.tenant_id;
  IF debits <> credits THEN
    RAISE EXCEPTION 'payroll ledger journal % is unbalanced (debit % <> credit %)',
      NEW.journal_id, debits, credits
      USING ERRCODE = 'integrity_constraint_violation';
  END IF;
  RETURN NULL;
END;
$$ LANGUAGE plpgsql;
DROP TRIGGER IF EXISTS trg_staff_payroll_ledger_journal_balanced ON staff_payroll_ledger_entries;
CREATE CONSTRAINT TRIGGER trg_staff_payroll_ledger_journal_balanced
  AFTER INSERT ON staff_payroll_ledger_entries
  DEFERRABLE INITIALLY DEFERRED
  FOR EACH ROW EXECUTE FUNCTION staff_payroll_ledger_journal_balanced();
INSERT INTO schema_migrations (filename)
VALUES ('320_payroll_ledger_journal_balanced.sql')
ON CONFLICT (filename) DO NOTHING;
