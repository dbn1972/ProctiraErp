-- PRC-M202: tie fee adjustments to their ledger journal; refunds and
-- concessions become immutable once posted.
--
-- After 245, fee_credit_notes and fee_write_offs reject UPDATE/DELETE, but:
--   * no adjustment row says which fee_ledger_entries journal posted it, so
--     an adjustment can exist without a journal (or a journal without its
--     adjustment) and nothing in the database notices;
--   * fee_refunds and fee_concessions are still freely mutable and deletable.
--
-- Fix:
--   1. journal_id UUID on fee_credit_notes, fee_write_offs, fee_refunds and
--      fee_concessions. FeesService now generates the journal id first and
--      writes it on the adjustment row and on every leg of the journal it
--      posts, in the same transaction.
--   2. A posted credit note, write-off or refund must carry a journal_id
--      (CHECK ... NOT VALID: enforced for every new row; rows written before
--      this migration have no journal id and are not rewritten, see below).
--   3. A DEFERRABLE INITIALLY DEFERRED constraint trigger checks at COMMIT
--      that the journal exists in fee_ledger_entries for the same tenant and
--      invoice. fee_ledger_entries.journal_id is not unique (one row per leg),
--      so a plain FOREIGN KEY cannot express this; the trigger is the tie.
--      For credit notes, write-offs and refunds the journal's debit total must
--      also equal the adjustment amount. A concession journal may post less
--      than the concession's face (it is capped at the unpaid balance), so for
--      concessions only existence and invoice are checked.
--   4. fee_refunds rejects UPDATE and DELETE (the 245 pattern; the service only
--      ever inserts status='posted').
--      fee_concessions rejects DELETE. UPDATE may only make the moves the
--      service makes: pending -> approved | rejected, approved -> rejected
--      (scholarship netting reversal), approver_id while pending, and
--      invoice_id / journal_id from NULL to a value once. Every other column
--      is fixed after INSERT.
--
-- Legacy rows: existing adjustments keep journal_id NULL. Their journals
-- carry no adjustment id either, so there is no reliable key to backfill
-- from; guessing by invoice + amount + time could tie a row to the wrong
-- journal. The CHECKs stay NOT VALID until a reconciliation backfills them.
--
-- Rollback (forward migration): drop the four triggers and their functions,
-- the three CHECK constraints, and the journal_id columns.
ALTER TABLE fee_credit_notes ADD COLUMN IF NOT EXISTS journal_id UUID;
ALTER TABLE fee_write_offs ADD COLUMN IF NOT EXISTS journal_id UUID;
ALTER TABLE fee_refunds ADD COLUMN IF NOT EXISTS journal_id UUID;
ALTER TABLE fee_concessions ADD COLUMN IF NOT EXISTS journal_id UUID;
ALTER TABLE fee_credit_notes DROP CONSTRAINT IF EXISTS fee_credit_notes_posted_journal_chk;
ALTER TABLE fee_credit_notes
  ADD CONSTRAINT fee_credit_notes_posted_journal_chk
  CHECK (status <> 'posted' OR journal_id IS NOT NULL) NOT VALID;
ALTER TABLE fee_write_offs DROP CONSTRAINT IF EXISTS fee_write_offs_posted_journal_chk;
ALTER TABLE fee_write_offs
  ADD CONSTRAINT fee_write_offs_posted_journal_chk
  CHECK (status <> 'posted' OR journal_id IS NOT NULL) NOT VALID;
ALTER TABLE fee_refunds DROP CONSTRAINT IF EXISTS fee_refunds_posted_journal_chk;
ALTER TABLE fee_refunds
  ADD CONSTRAINT fee_refunds_posted_journal_chk
  CHECK (status <> 'posted' OR journal_id IS NOT NULL) NOT VALID;
-- 3. Journal tie, checked at COMMIT (the journal legs may be inserted after
--    the adjustment row in the same transaction).
CREATE OR REPLACE FUNCTION fee_adjustment_journal_tie() RETURNS trigger AS $$
DECLARE
  legs    BIGINT;
  debits  BIGINT;
BEGIN
  IF NEW.journal_id IS NULL THEN
    RETURN NULL;
  END IF;
  IF TG_OP = 'UPDATE' AND OLD.journal_id IS NOT DISTINCT FROM NEW.journal_id THEN
    RETURN NULL;
  END IF;
  SELECT count(*),
         COALESCE(SUM(CASE WHEN side = 'debit' THEN amount_cents END), 0)
    INTO legs, debits
    FROM fee_ledger_entries
   WHERE tenant_id = NEW.tenant_id
     AND journal_id = NEW.journal_id
     AND invoice_id = NEW.invoice_id;
  IF legs = 0 THEN
    RAISE EXCEPTION '% % references fee ledger journal % that does not exist for invoice %',
      TG_TABLE_NAME, NEW.id, NEW.journal_id, NEW.invoice_id
      USING ERRCODE = 'foreign_key_violation';
  END IF;
  IF TG_TABLE_NAME <> 'fee_concessions' AND debits <> NEW.amount_cents THEN
    RAISE EXCEPTION '% % amount % does not match fee ledger journal % (debit %)',
      TG_TABLE_NAME, NEW.id, NEW.amount_cents, NEW.journal_id, debits
      USING ERRCODE = 'integrity_constraint_violation';
  END IF;
  RETURN NULL;
END;
$$ LANGUAGE plpgsql;
DROP TRIGGER IF EXISTS trg_fee_credit_notes_journal_tie ON fee_credit_notes;
CREATE CONSTRAINT TRIGGER trg_fee_credit_notes_journal_tie
  AFTER INSERT ON fee_credit_notes
  DEFERRABLE INITIALLY DEFERRED
  FOR EACH ROW EXECUTE FUNCTION fee_adjustment_journal_tie();
DROP TRIGGER IF EXISTS trg_fee_write_offs_journal_tie ON fee_write_offs;
CREATE CONSTRAINT TRIGGER trg_fee_write_offs_journal_tie
  AFTER INSERT ON fee_write_offs
  DEFERRABLE INITIALLY DEFERRED
  FOR EACH ROW EXECUTE FUNCTION fee_adjustment_journal_tie();
DROP TRIGGER IF EXISTS trg_fee_refunds_journal_tie ON fee_refunds;
CREATE CONSTRAINT TRIGGER trg_fee_refunds_journal_tie
  AFTER INSERT ON fee_refunds
  DEFERRABLE INITIALLY DEFERRED
  FOR EACH ROW EXECUTE FUNCTION fee_adjustment_journal_tie();
DROP TRIGGER IF EXISTS trg_fee_concessions_journal_tie ON fee_concessions;
CREATE CONSTRAINT TRIGGER trg_fee_concessions_journal_tie
  AFTER INSERT OR UPDATE OF journal_id ON fee_concessions
  DEFERRABLE INITIALLY DEFERRED
  FOR EACH ROW EXECUTE FUNCTION fee_adjustment_journal_tie();
-- 4a. Refunds are append-only.
CREATE OR REPLACE FUNCTION fee_refunds_immutable() RETURNS trigger AS $$
BEGIN
  RAISE EXCEPTION
    'fee_refunds is append-only; post a reversing entry instead of editing a refund'
    USING ERRCODE = 'integrity_constraint_violation';
  RETURN NULL;
END;
$$ LANGUAGE plpgsql;
DROP TRIGGER IF EXISTS trg_fee_refunds_immutable ON fee_refunds;
CREATE TRIGGER trg_fee_refunds_immutable
  BEFORE UPDATE OR DELETE ON fee_refunds
  FOR EACH ROW EXECUTE FUNCTION fee_refunds_immutable();
-- 4b. Concessions: no DELETE; UPDATE limited to the service's state moves.
CREATE OR REPLACE FUNCTION fee_concessions_guard() RETURNS trigger AS $$
BEGIN
  IF TG_OP = 'DELETE' THEN
    RAISE EXCEPTION 'fee_concessions rows cannot be deleted; reject or reverse the concession'
      USING ERRCODE = 'integrity_constraint_violation';
  END IF;
  IF NEW.id IS DISTINCT FROM OLD.id
     OR NEW.tenant_id IS DISTINCT FROM OLD.tenant_id
     OR NEW.student_id IS DISTINCT FROM OLD.student_id
     OR NEW.structure_id IS DISTINCT FROM OLD.structure_id
     OR NEW.kind IS DISTINCT FROM OLD.kind
     OR NEW.percent IS DISTINCT FROM OLD.percent
     OR NEW.amount_cents IS DISTINCT FROM OLD.amount_cents
     OR NEW.reason IS DISTINCT FROM OLD.reason
     OR NEW.source_disbursement_id IS DISTINCT FROM OLD.source_disbursement_id
     OR NEW.created_by IS DISTINCT FROM OLD.created_by
     OR NEW.created_at IS DISTINCT FROM OLD.created_at THEN
    RAISE EXCEPTION 'fee_concessions % terms are fixed after creation', OLD.id
      USING ERRCODE = 'integrity_constraint_violation';
  END IF;
  IF NEW.status IS DISTINCT FROM OLD.status
     AND NOT (
       (OLD.status = 'pending' AND NEW.status IN ('approved', 'rejected'))
       OR (OLD.status = 'approved' AND NEW.status = 'rejected')
     ) THEN
    RAISE EXCEPTION 'fee_concessions % cannot move from % to %', OLD.id, OLD.status, NEW.status
      USING ERRCODE = 'integrity_constraint_violation';
  END IF;
  IF NEW.approver_id IS DISTINCT FROM OLD.approver_id AND OLD.status <> 'pending' THEN
    RAISE EXCEPTION 'fee_concessions % approver is fixed once decided', OLD.id
      USING ERRCODE = 'integrity_constraint_violation';
  END IF;
  IF (OLD.invoice_id IS NOT NULL AND NEW.invoice_id IS DISTINCT FROM OLD.invoice_id)
     OR (OLD.journal_id IS NOT NULL AND NEW.journal_id IS DISTINCT FROM OLD.journal_id) THEN
    RAISE EXCEPTION 'fee_concessions % invoice and journal can be set once only', OLD.id
      USING ERRCODE = 'integrity_constraint_violation';
  END IF;
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;
DROP TRIGGER IF EXISTS trg_fee_concessions_guard ON fee_concessions;
CREATE TRIGGER trg_fee_concessions_guard
  BEFORE UPDATE OR DELETE ON fee_concessions
  FOR EACH ROW EXECUTE FUNCTION fee_concessions_guard();
INSERT INTO schema_migrations (filename)
VALUES ('321_fee_adjustment_journal_tie.sql')
ON CONFLICT (filename) DO NOTHING;
