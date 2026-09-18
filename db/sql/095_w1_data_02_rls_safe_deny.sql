-- W1-DATA-02 COMPLETE: make the residual 047 tenant policies fail closed.
--
-- 047 cast the tenant GUC to UUID. A malformed/non-UUID context therefore
-- raised 22P02 instead of evaluating to false. 071 canonicalized the GUC
-- reader but intentionally preserved the trailing cast. This forward fix
-- casts the UUID column to text and compares it with the canonical text helper.
--
-- Reassert ENABLE + FORCE and preserve the original permissive ALL/PUBLIC
-- policy shape, including WITH CHECK for writes. Historical migrations remain
-- checksum-stable; the domain SQL runner records this file in its own ledger.

ALTER TABLE academic_rollover_runs ENABLE ROW LEVEL SECURITY;
ALTER TABLE academic_rollover_runs FORCE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS academic_rollover_runs_tenant ON academic_rollover_runs;
CREATE POLICY academic_rollover_runs_tenant ON academic_rollover_runs
  AS PERMISSIVE FOR ALL TO PUBLIC
  USING (tenant_id::text = app_tenant_id())
  WITH CHECK (tenant_id::text = app_tenant_id());

ALTER TABLE lms_modules ENABLE ROW LEVEL SECURITY;
ALTER TABLE lms_modules FORCE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS lms_modules_tenant ON lms_modules;
CREATE POLICY lms_modules_tenant ON lms_modules
  AS PERMISSIVE FOR ALL TO PUBLIC
  USING (tenant_id::text = app_tenant_id())
  WITH CHECK (tenant_id::text = app_tenant_id());

ALTER TABLE lms_module_items ENABLE ROW LEVEL SECURITY;
ALTER TABLE lms_module_items FORCE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS lms_module_items_tenant ON lms_module_items;
CREATE POLICY lms_module_items_tenant ON lms_module_items
  AS PERMISSIVE FOR ALL TO PUBLIC
  USING (tenant_id::text = app_tenant_id())
  WITH CHECK (tenant_id::text = app_tenant_id());
