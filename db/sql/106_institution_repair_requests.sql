-- Facility condition enum + repair requests (institutions infrastructure tab).
-- Applied after 105. Existing free-text conditions are mapped onto the closed set.

UPDATE institution_infrastructure
SET condition = CASE
  WHEN condition IN ('Good', 'Fair', 'Needs repair', 'Unknown') THEN condition
  WHEN upper(condition) IN ('GOOD', 'AVAILABLE', 'NEW') THEN 'Good'
  WHEN upper(condition) IN ('FAIR', 'AVERAGE') THEN 'Fair'
  WHEN upper(condition) LIKE '%REPAIR%'
    OR upper(condition) IN ('POOR', 'DAMAGED', 'BAD') THEN 'Needs repair'
  ELSE 'Unknown'
END
WHERE condition IS NOT NULL;

ALTER TABLE institution_infrastructure
  DROP CONSTRAINT IF EXISTS institution_infrastructure_condition_check;

ALTER TABLE institution_infrastructure
  ADD CONSTRAINT institution_infrastructure_condition_check
  CHECK (condition IN ('Good', 'Fair', 'Needs repair', 'Unknown'));

CREATE TABLE IF NOT EXISTS institution_repair_requests (
  id UUID PRIMARY KEY,
  tenant_id UUID NOT NULL,
  institution_id UUID NOT NULL,
  infrastructure_id UUID NOT NULL REFERENCES institution_infrastructure(id) ON DELETE CASCADE,
  summary TEXT NOT NULL,
  status TEXT NOT NULL DEFAULT 'open' CHECK (status IN ('open', 'closed')),
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS institution_repair_requests_institution_idx
  ON institution_repair_requests (tenant_id, institution_id, created_at DESC);

ALTER TABLE institution_repair_requests ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS tenant_isolation ON institution_repair_requests;
CREATE POLICY tenant_isolation ON institution_repair_requests
  FOR ALL
  USING (tenant_id::text = NULLIF(current_setting('app.tenant_id', true), ''))
  WITH CHECK (tenant_id::text = NULLIF(current_setting('app.tenant_id', true), ''));
ALTER TABLE institution_repair_requests FORCE ROW LEVEL SECURITY;
