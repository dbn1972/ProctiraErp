-- Wave: principal-dashboard-parity — adds a status field to nurse incidents
-- so open/closed can be counted on the principal dashboard (Req 4 AC5/AC6).
--
-- Default 'open' is deliberate: existing rows are treated conservatively as
-- still needing attention rather than silently closed, since there is no way
-- to know their true resolution state retroactively.
--
-- Idempotent per tools/scripts/apply-sql.sh conventions (ADD COLUMN IF NOT
-- EXISTS). The existing `tenant_isolation` RLS policy on
-- health_nurse_incidents (db/sql/046_health_incidents_etl_schema.sql) is left
-- untouched — adding a column doesn't require touching row-level policy.
ALTER TABLE health_nurse_incidents
  ADD COLUMN IF NOT EXISTS status TEXT NOT NULL DEFAULT 'open'
    CHECK (status IN ('open', 'closed'));
