-- PRC-M623 (N3) — column-level SELECT for the PHI retention role.
--
-- 312 granted proctira_phi_retention full-row SELECT on tenants and students.
-- The students tenant_isolation policy also passes rows when
-- app.platform_admin = '1', which any role can set, so that credential could
-- read every column of every tenant's students. tools/scripts/phi-retention-job.mjs
-- reads only:
--   - tenants.id, tenants.legal_hold (tenant enumeration and the tenant hold);
--   - students.id, students.date_of_birth (LEFT JOIN students s ON s.id = r.student_id
--     and the minor-retention window).
-- RLS policy expressions (students.tenant_id, tenants.id) need no column
-- privilege, so no other column is granted. SELECT on every other column of
-- these tables is denied.
--
-- Idempotent and role-guarded like 312. apply-runtime-table-privileges.sh
-- re-applies the same statements on every apply-sql run
-- (PHI_RETENTION_GRANTS in tools/scripts/runtime-table-privileges-lib.mjs).
--
-- Rollback (future forward migration; keep the sync list in step):
--   GRANT SELECT ON TABLE tenants, students TO proctira_phi_retention;
DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'proctira_phi_retention') THEN
    RAISE NOTICE 'PRC-M623: role proctira_phi_retention missing; skip PHI retention column grants';
    RETURN;
  END IF;
  REVOKE SELECT ON TABLE tenants, students FROM proctira_phi_retention;
  GRANT SELECT (id, legal_hold) ON TABLE tenants TO proctira_phi_retention;
  GRANT SELECT (id, date_of_birth) ON TABLE students TO proctira_phi_retention;
END $$;
