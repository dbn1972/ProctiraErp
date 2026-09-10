-- Migration: Wave 7 RLS hardening (G-732) — attendance_audit, tenants, tenant_theme_*
--
-- attendance_audit carries no tenant_id; tenancy is derived from the parent
-- attendance row (student_attendance or staff_attendance), which is itself
-- RLS-protected on `app.current_tenant_id`. Rows are visible / insertable only
-- when the parent belongs to the bound tenant (or under platform-admin scope).
-- FORCE so the owning app role cannot bypass it.

ALTER TABLE "attendance_audit" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "attendance_audit" FORCE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS tenant_isolation ON "attendance_audit";
CREATE POLICY tenant_isolation ON "attendance_audit"
  FOR ALL
  USING (
    current_setting('app.platform_admin', true) = '1'
    OR EXISTS (
      SELECT 1 FROM "student_attendance" sa
       WHERE sa.id = "attendance_audit".attendance_id
         AND sa.tenant_id::text = NULLIF(current_setting('app.current_tenant_id', true), '')
    )
    OR EXISTS (
      SELECT 1 FROM "staff_attendance" st
       WHERE st.id = "attendance_audit".attendance_id
         AND st.tenant_id::text = NULLIF(current_setting('app.current_tenant_id', true), '')
    )
  )
  WITH CHECK (
    current_setting('app.platform_admin', true) = '1'
    OR EXISTS (
      SELECT 1 FROM "student_attendance" sa
       WHERE sa.id = "attendance_audit".attendance_id
         AND sa.tenant_id::text = NULLIF(current_setting('app.current_tenant_id', true), '')
    )
    OR EXISTS (
      SELECT 1 FROM "staff_attendance" st
       WHERE st.id = "attendance_audit".attendance_id
         AND st.tenant_id::text = NULLIF(current_setting('app.current_tenant_id', true), '')
    )
  );

-- ---------------------------------------------------------------------------
-- tenants: a tenant may see / update only itself; the control plane binds
-- app.platform_admin = '1'. Mirrors db/sql/021 so Prisma-only deployments get
-- the same guarantee. Accept both GUC names (raw-SQL repos bind app.tenant_id,
-- Prisma paths bind app.current_tenant_id).
-- ---------------------------------------------------------------------------
ALTER TABLE "tenants" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "tenants" FORCE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS tenant_isolation ON "tenants";
CREATE POLICY tenant_isolation ON "tenants"
  FOR ALL
  USING (
    current_setting('app.platform_admin', true) = '1'
    OR id::text = COALESCE(
         NULLIF(current_setting('app.tenant_id', true), ''),
         NULLIF(current_setting('app.current_tenant_id', true), ''))
  )
  WITH CHECK (
    current_setting('app.platform_admin', true) = '1'
    OR id::text = COALESCE(
         NULLIF(current_setting('app.tenant_id', true), ''),
         NULLIF(current_setting('app.current_tenant_id', true), ''))
  );

-- ---------------------------------------------------------------------------
-- tenant_theme_versions / tenant_theme_drafts: branding tables shipped without
-- any policy. Plain tenant_id equality; FORCE so the owner role is bound too.
-- ---------------------------------------------------------------------------
ALTER TABLE "tenant_theme_versions" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "tenant_theme_versions" FORCE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS tenant_isolation ON "tenant_theme_versions";
CREATE POLICY tenant_isolation ON "tenant_theme_versions"
  FOR ALL
  USING (
    current_setting('app.platform_admin', true) = '1'
    OR tenant_id::text = COALESCE(
         NULLIF(current_setting('app.tenant_id', true), ''),
         NULLIF(current_setting('app.current_tenant_id', true), ''))
  )
  WITH CHECK (
    tenant_id::text = COALESCE(
         NULLIF(current_setting('app.tenant_id', true), ''),
         NULLIF(current_setting('app.current_tenant_id', true), ''))
  );

ALTER TABLE "tenant_theme_drafts" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "tenant_theme_drafts" FORCE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS tenant_isolation ON "tenant_theme_drafts";
CREATE POLICY tenant_isolation ON "tenant_theme_drafts"
  FOR ALL
  USING (
    current_setting('app.platform_admin', true) = '1'
    OR tenant_id::text = COALESCE(
         NULLIF(current_setting('app.tenant_id', true), ''),
         NULLIF(current_setting('app.current_tenant_id', true), ''))
  )
  WITH CHECK (
    tenant_id::text = COALESCE(
         NULLIF(current_setting('app.tenant_id', true), ''),
         NULLIF(current_setting('app.current_tenant_id', true), ''))
  );

