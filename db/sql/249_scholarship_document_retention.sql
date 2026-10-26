-- PRC-M215: scholarship_application_documents (income certificates,
-- marksheets, caste/category certificates, ID proofs, and other
-- scheme-required supporting documents) had no retention marker at all.
--
-- docs/audits/remediation/decisions/D5-privacy-retention.md's retention
-- schedule table has no row for "scholarship supporting documents"
-- specifically. Its closest analogous category is "Student academic
-- records" (duration of enrolment + 7 years), so this migration uses that
-- default pending counsel confirmation -- consistent with D5's own
-- "DRAFT — pending legal review" framing (see D5's guardrail section). This
-- is an interim default, not a legal determination.
--
-- Adds a nullable, additive `retention_until` DATE column. A BEFORE INSERT
-- trigger computes `uploaded_at::date + interval '7 years'` ONLY when the
-- inserted value is NULL -- an explicitly supplied value (e.g. a future
-- counsel-driven policy engine that computes a different date per document
-- type or jurisdiction) is never overwritten.
--
-- This migration is schema-only, per the task brief: it does NOT build the
-- purge/erasure job itself (out of db-only scope per the ledger note; D5's
-- erasure/anonymisation mechanism is implemented against configurable
-- policy elsewhere, not invented here).
--
-- Rollback: forward-only; a later migration may DROP COLUMN retention_until
-- or replace the trigger's default computation once counsel confirms a
-- different rule.

ALTER TABLE scholarship_application_documents
  ADD COLUMN IF NOT EXISTS retention_until DATE;

CREATE OR REPLACE FUNCTION scholarship_application_documents_default_retention()
RETURNS TRIGGER AS $$
BEGIN
  IF NEW.retention_until IS NULL THEN
    -- D5 interim default (closest analog: "Student academic records",
    -- duration of enrolment + 7 years) -- pending counsel confirmation.
    NEW.retention_until := NEW.uploaded_at::date + INTERVAL '7 years';
  END IF;
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

DROP TRIGGER IF EXISTS trg_scholarship_application_documents_default_retention
  ON scholarship_application_documents;
CREATE TRIGGER trg_scholarship_application_documents_default_retention
  BEFORE INSERT ON scholarship_application_documents
  FOR EACH ROW
  EXECUTE FUNCTION scholarship_application_documents_default_retention();

INSERT INTO schema_migrations (filename)
VALUES ('249_scholarship_document_retention.sql')
ON CONFLICT (filename) DO NOTHING;
