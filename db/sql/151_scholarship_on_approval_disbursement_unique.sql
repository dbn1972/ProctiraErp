-- PRC-H083 (fix step 3) — at most one on-approval disbursement per scholarship application.
--
-- approveApplicationAtomic already serialises approval (application row lock, conditional
-- slot claim, status-guarded update). This makes the on-approval first instalment
-- idempotent at the database level too: a replayed or racing approval cannot insert a
-- second "on approval" disbursement for the same application.
--
-- disbursement_kind marks how a row was created; NULL = manual / scheduled instalments
-- (unconstrained). Existing rows stay NULL, so the unique index cannot fail on old data.
--
-- Additive / idempotent. CHECK added NOT VALID then VALIDATEd. Needs DB review.

ALTER TABLE scholarship_disbursements
  ADD COLUMN IF NOT EXISTS disbursement_kind TEXT;

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint
     WHERE conname = 'scholarship_disbursements_kind_check'
       AND conrelid = 'scholarship_disbursements'::regclass
  ) THEN
    ALTER TABLE scholarship_disbursements
      ADD CONSTRAINT scholarship_disbursements_kind_check
      CHECK (disbursement_kind IS NULL OR disbursement_kind IN ('on_approval'))
      NOT VALID;
  END IF;
END $$;

ALTER TABLE scholarship_disbursements
  VALIDATE CONSTRAINT scholarship_disbursements_kind_check;

CREATE UNIQUE INDEX IF NOT EXISTS uq_scholarship_disbursements_on_approval
  ON scholarship_disbursements (tenant_id, application_id)
  WHERE disbursement_kind = 'on_approval';

-- RLS (ENABLE + FORCE, tenant_isolation) from 016/047 already covers the new column.
ALTER TABLE scholarship_disbursements ENABLE ROW LEVEL SECURITY;
ALTER TABLE scholarship_disbursements FORCE ROW LEVEL SECURITY;

DO $$
BEGIN
  IF EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'proctira_app') THEN
    GRANT SELECT, INSERT, UPDATE ON scholarship_disbursements TO proctira_app;
  END IF;
END $$;

INSERT INTO schema_migrations (filename)
VALUES ('151_scholarship_on_approval_disbursement_unique.sql')
ON CONFLICT (filename) DO NOTHING;
