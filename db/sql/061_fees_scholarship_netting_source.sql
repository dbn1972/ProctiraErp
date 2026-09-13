-- W2-FIN-09: scholarship netting idempotency via source_disbursement_id
-- (replaces free-text reason.substring / includes matching).

ALTER TABLE fee_concessions
  ADD COLUMN IF NOT EXISTS source_disbursement_id TEXT;

-- Manual concessions remain one-per-student-structure; scholarship netting
-- rows are keyed by source_disbursement_id instead.
ALTER TABLE fee_concessions
  DROP CONSTRAINT IF EXISTS fee_concessions_tenant_id_student_id_structure_id_key;

CREATE UNIQUE INDEX IF NOT EXISTS uq_fee_concessions_manual_student_structure
  ON fee_concessions (tenant_id, student_id, structure_id)
  WHERE source_disbursement_id IS NULL;

CREATE UNIQUE INDEX IF NOT EXISTS uq_fee_concessions_tenant_source_disbursement
  ON fee_concessions (tenant_id, source_disbursement_id)
  WHERE source_disbursement_id IS NOT NULL;

CREATE INDEX IF NOT EXISTS fee_concessions_source_disbursement_idx
  ON fee_concessions (tenant_id, source_disbursement_id)
  WHERE source_disbursement_id IS NOT NULL;
