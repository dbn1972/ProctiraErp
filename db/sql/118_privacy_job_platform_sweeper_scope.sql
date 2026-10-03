-- PRC-H078: let the privacy stuck-job sweeper see queued jobs across tenants.
--
-- PgPrivacyRepository.listStuckQueuedJobs runs under withPlatformScope
-- (set_config('app.platform_admin', '1', true), transaction-local) and selects
-- id/tenant_id of jobs stuck in 'queued'. 078's tenant_isolation policies on the
-- two job tables only match app.tenant_id, so the scan returned no rows and the
-- sweeper never retried anything.
--
-- Follows the app.platform_admin escape used by 021/022, but narrower: a
-- separate PERMISSIVE policy FOR SELECT only. Platform scope can read job rows;
-- it cannot INSERT/UPDATE/DELETE them. The sweeper's retry path re-binds the
-- job's own tenant (withPgTenant) for every write, so tenant_isolation still
-- governs all mutations. The existing tenant_isolation policies are unchanged.
--
-- Data safety: policy DDL only, no data touched. ENABLE + FORCE RLS reasserted.
-- Idempotent.
--
-- Rollback: DROP POLICY privacy_platform_sweeper_read ON both tables (the sweeper
-- then fails closed: no cross-tenant rows, no retries).
ALTER TABLE privacy_anonymization_jobs ENABLE ROW LEVEL SECURITY;
ALTER TABLE privacy_anonymization_jobs FORCE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS privacy_platform_sweeper_read ON privacy_anonymization_jobs;
CREATE POLICY privacy_platform_sweeper_read ON privacy_anonymization_jobs
  AS PERMISSIVE FOR SELECT TO PUBLIC
  USING (current_setting('app.platform_admin', true) = '1');

ALTER TABLE privacy_tenant_offboard_jobs ENABLE ROW LEVEL SECURITY;
ALTER TABLE privacy_tenant_offboard_jobs FORCE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS privacy_platform_sweeper_read ON privacy_tenant_offboard_jobs;
CREATE POLICY privacy_platform_sweeper_read ON privacy_tenant_offboard_jobs
  AS PERMISSIVE FOR SELECT TO PUBLIC
  USING (current_setting('app.platform_admin', true) = '1');
