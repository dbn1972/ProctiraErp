-- PRC-M623 — table grants for the PHI retention CronJob role.
--
-- The retention job used to share the BYPASSRLS backup credential
-- (BACKUP_DATABASE_URL) for a cross-tenant hard DELETE. It now connects as
-- proctira_phi_retention (created NOSUPERUSER NOBYPASSRLS by
-- db/bootstrap/01_runtime_roles.sql), binds app.tenant_id per tenant and is
-- filtered by the normal tenant_isolation policies. It gets only what
-- tools/scripts/phi-retention-job.mjs uses:
--   - SELECT tenants (enumerate under app.platform_admin, legal_hold flag),
--     students (date of birth for the minor window) and privacy_legal_holds;
--   - SELECT, DELETE on the two PHI tables it expires;
--   - INSERT on audit_ingest_queue (PRC-M435 per-deletion audit events, sealed
--     into the keyed chain by the gateway drain).
-- No UPDATE, no other table, no BYPASSRLS.
--
-- Additive / idempotent. When the role does not exist yet (bootstrap not re-run
-- on an existing install) the grants are skipped with a NOTICE; the job then
-- fails closed on its privilege assertions until the role is provisioned and
-- this file's grants are applied (docs/BACKUP_RESTORE.md §3.5).
--
-- Rollback (future forward migration; point the retention CronJob back at a
-- non-BYPASSRLS credential first, the job refuses SUPERUSER/BYPASSRLS roles):
--   REVOKE ALL ON TABLE tenants, students, privacy_legal_holds,
--     counselling_sessions, health_special_needs_assessments, audit_ingest_queue
--     FROM proctira_phi_retention;
DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'proctira_phi_retention') THEN
    RAISE NOTICE 'PRC-M623: role proctira_phi_retention missing; skip PHI retention grants';
    RETURN;
  END IF;
  GRANT SELECT ON TABLE tenants, students, privacy_legal_holds TO proctira_phi_retention;
  GRANT SELECT, DELETE ON TABLE counselling_sessions, health_special_needs_assessments
    TO proctira_phi_retention;
  GRANT INSERT ON TABLE audit_ingest_queue TO proctira_phi_retention;
END $$;
