-- PRC-M339 / NEW-g5_academic-004: let the report scheduler lease due schedules
-- under platform scope.
--
-- PgReportStore.claimDueSchedules runs under withPlatformScope
-- (set_config('app.platform_admin', '1', true), transaction-local, no
-- app.tenant_id) and issues `UPDATE report_schedules ... RETURNING` to lease
-- due rows. 037 only grants report_schedules a tenant_isolation policy
-- (FOR ALL, requires app.tenant_id) and platform_admin_read (FOR SELECT). Under
-- the non-BYPASSRLS proctira_app role the UPDATE therefore matched ZERO rows:
-- scheduled reports never ran on Postgres, silently.
--
-- Follows the app.platform_admin escape used by 021/022/118, but narrower: a
-- separate PERMISSIVE policy FOR UPDATE only. Platform scope can lease
-- (update) schedule rows; it still cannot INSERT or DELETE them (those remain
-- governed by tenant_isolation, which requires the row's own tenant). The
-- WITH CHECK keeps the escape symmetric so the leased row (same tenant_id,
-- only next_run_at/updated_at change) satisfies the policy on write-back.
--
-- Data safety: policy DDL only, no data touched. ENABLE + FORCE RLS reasserted.
-- Idempotent.
--
-- Rollback: DROP POLICY report_platform_scheduler_update ON report_schedules
-- (the scheduler then fails closed: UPDATE matches no rows, nothing leased).
ALTER TABLE report_schedules ENABLE ROW LEVEL SECURITY;
ALTER TABLE report_schedules FORCE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS report_platform_scheduler_update ON report_schedules;
CREATE POLICY report_platform_scheduler_update ON report_schedules
  AS PERMISSIVE FOR UPDATE TO PUBLIC
  USING (current_setting('app.platform_admin', true) = '1')
  WITH CHECK (current_setting('app.platform_admin', true) = '1');
