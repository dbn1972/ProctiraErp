-- PRC-M201+M202: payroll lines/ledger and fee adjustment (credit note /
-- write-off) tables have no immutability guard, unlike their sibling
-- staff_payroll_runs (db/sql/083's staff_payroll_runs_posted_immutable()).
--
-- staff_payroll_lines / staff_payroll_ledger_entries (PRC-M201): these are
-- always children of an already-immutable-once-posted staff_payroll_runs row
-- (083). They have no independent voiding concept — a correction reverses +
-- replaces the parent run (new lines/ledger rows under the new run), never
-- edits an existing line/ledger row in place. Rejected unconditionally
-- (UPDATE and DELETE), mirroring 083's staff_payroll_runs_posted_immutable
-- pattern exactly.
--
-- fee_credit_notes / fee_write_offs (PRC-M202): grepped every call site in
-- packages/backend/fees/src/*.ts (FeesService.issueCreditNote /
-- writeOffInvoice, PgFeesRepository.createCreditNote / createWriteOff) --
-- both only ever INSERT with status='posted'. fees-repository.ts's
-- `AdjustmentStatus = 'posted' | 'voided'` union includes 'voided', but no
-- code path anywhere in the repository writes it; there is no
-- posted->voided UPDATE to preserve. Rejected unconditionally (UPDATE and
-- DELETE) for both tables; if a future voiding feature needs to transition
-- status, it should insert a new reversing credit-note/write-off row (the
-- same reverse-and-replace pattern 083 uses for payroll), not mutate the
-- posted row in place.
--
-- Rollback: forward-only; a later migration may DROP these triggers/functions
-- if a genuine in-place transition is designed and added deliberately.

CREATE OR REPLACE FUNCTION staff_payroll_lines_immutable()
RETURNS TRIGGER AS $$
BEGIN
  RAISE EXCEPTION
    'staff_payroll_lines is append-only (child of an immutable posted run); insert a reversal/replacement run instead'
    USING ERRCODE = 'integrity_constraint_violation';
  RETURN NULL;
END;
$$ LANGUAGE plpgsql;

DROP TRIGGER IF EXISTS trg_staff_payroll_lines_immutable ON staff_payroll_lines;
CREATE TRIGGER trg_staff_payroll_lines_immutable
  BEFORE UPDATE OR DELETE ON staff_payroll_lines
  FOR EACH ROW
  EXECUTE FUNCTION staff_payroll_lines_immutable();

CREATE OR REPLACE FUNCTION staff_payroll_ledger_entries_immutable()
RETURNS TRIGGER AS $$
BEGIN
  RAISE EXCEPTION
    'staff_payroll_ledger_entries is append-only (child of an immutable posted run); insert a reversal/replacement run instead'
    USING ERRCODE = 'integrity_constraint_violation';
  RETURN NULL;
END;
$$ LANGUAGE plpgsql;

DROP TRIGGER IF EXISTS trg_staff_payroll_ledger_entries_immutable ON staff_payroll_ledger_entries;
CREATE TRIGGER trg_staff_payroll_ledger_entries_immutable
  BEFORE UPDATE OR DELETE ON staff_payroll_ledger_entries
  FOR EACH ROW
  EXECUTE FUNCTION staff_payroll_ledger_entries_immutable();

CREATE OR REPLACE FUNCTION fee_credit_notes_immutable()
RETURNS TRIGGER AS $$
BEGIN
  RAISE EXCEPTION
    'fee_credit_notes is append-only; no code path voids a posted row in place -- insert a reversing entry instead'
    USING ERRCODE = 'integrity_constraint_violation';
  RETURN NULL;
END;
$$ LANGUAGE plpgsql;

DROP TRIGGER IF EXISTS trg_fee_credit_notes_immutable ON fee_credit_notes;
CREATE TRIGGER trg_fee_credit_notes_immutable
  BEFORE UPDATE OR DELETE ON fee_credit_notes
  FOR EACH ROW
  EXECUTE FUNCTION fee_credit_notes_immutable();

CREATE OR REPLACE FUNCTION fee_write_offs_immutable()
RETURNS TRIGGER AS $$
BEGIN
  RAISE EXCEPTION
    'fee_write_offs is append-only; no code path voids a posted row in place -- insert a reversing entry instead'
    USING ERRCODE = 'integrity_constraint_violation';
  RETURN NULL;
END;
$$ LANGUAGE plpgsql;

DROP TRIGGER IF EXISTS trg_fee_write_offs_immutable ON fee_write_offs;
CREATE TRIGGER trg_fee_write_offs_immutable
  BEFORE UPDATE OR DELETE ON fee_write_offs
  FOR EACH ROW
  EXECUTE FUNCTION fee_write_offs_immutable();

INSERT INTO schema_migrations (filename)
VALUES ('245_payroll_fee_adjustment_immutability.sql')
ON CONFLICT (filename) DO NOTHING;
