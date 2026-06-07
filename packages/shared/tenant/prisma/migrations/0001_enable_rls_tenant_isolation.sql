-- Migration: Enable Row-Level Security on all tenant-scoped tables
-- This migration enables RLS and creates tenant_isolation policies
-- that filter rows based on the PostgreSQL session variable `app.current_tenant_id`.
--
-- The Fastify tenant plugin sets this variable per request via:
--   SET LOCAL app.current_tenant_id = '<tenant_uuid>';
--
-- This ensures that application queries automatically see only the
-- current tenant's data without requiring explicit WHERE clauses.

-- ============================================================================
-- GEOGRAPHIC AREAS
-- ============================================================================
ALTER TABLE geographic_areas ENABLE ROW LEVEL SECURITY;

CREATE POLICY tenant_isolation_select ON geographic_areas
  FOR SELECT
  USING (tenant_id = current_setting('app.current_tenant_id')::uuid);

CREATE POLICY tenant_isolation_insert ON geographic_areas
  FOR INSERT
  WITH CHECK (tenant_id = current_setting('app.current_tenant_id')::uuid);

CREATE POLICY tenant_isolation_update ON geographic_areas
  FOR UPDATE
  USING (tenant_id = current_setting('app.current_tenant_id')::uuid)
  WITH CHECK (tenant_id = current_setting('app.current_tenant_id')::uuid);

CREATE POLICY tenant_isolation_delete ON geographic_areas
  FOR DELETE
  USING (tenant_id = current_setting('app.current_tenant_id')::uuid);

-- ============================================================================
-- BOARDS
-- ============================================================================
ALTER TABLE boards ENABLE ROW LEVEL SECURITY;

CREATE POLICY tenant_isolation_select ON boards
  FOR SELECT
  USING (tenant_id = current_setting('app.current_tenant_id')::uuid);

CREATE POLICY tenant_isolation_insert ON boards
  FOR INSERT
  WITH CHECK (tenant_id = current_setting('app.current_tenant_id')::uuid);

CREATE POLICY tenant_isolation_update ON boards
  FOR UPDATE
  USING (tenant_id = current_setting('app.current_tenant_id')::uuid)
  WITH CHECK (tenant_id = current_setting('app.current_tenant_id')::uuid);

CREATE POLICY tenant_isolation_delete ON boards
  FOR DELETE
  USING (tenant_id = current_setting('app.current_tenant_id')::uuid);

-- ============================================================================
-- INSTITUTIONS
-- ============================================================================
ALTER TABLE institutions ENABLE ROW LEVEL SECURITY;

CREATE POLICY tenant_isolation_select ON institutions
  FOR SELECT
  USING (tenant_id = current_setting('app.current_tenant_id')::uuid);

CREATE POLICY tenant_isolation_insert ON institutions
  FOR INSERT
  WITH CHECK (tenant_id = current_setting('app.current_tenant_id')::uuid);

CREATE POLICY tenant_isolation_update ON institutions
  FOR UPDATE
  USING (tenant_id = current_setting('app.current_tenant_id')::uuid)
  WITH CHECK (tenant_id = current_setting('app.current_tenant_id')::uuid);

CREATE POLICY tenant_isolation_delete ON institutions
  FOR DELETE
  USING (tenant_id = current_setting('app.current_tenant_id')::uuid);

-- ============================================================================
-- STUDENTS
-- ============================================================================
ALTER TABLE students ENABLE ROW LEVEL SECURITY;

CREATE POLICY tenant_isolation_select ON students
  FOR SELECT
  USING (tenant_id = current_setting('app.current_tenant_id')::uuid);

CREATE POLICY tenant_isolation_insert ON students
  FOR INSERT
  WITH CHECK (tenant_id = current_setting('app.current_tenant_id')::uuid);

CREATE POLICY tenant_isolation_update ON students
  FOR UPDATE
  USING (tenant_id = current_setting('app.current_tenant_id')::uuid)
  WITH CHECK (tenant_id = current_setting('app.current_tenant_id')::uuid);

CREATE POLICY tenant_isolation_delete ON students
  FOR DELETE
  USING (tenant_id = current_setting('app.current_tenant_id')::uuid);

-- ============================================================================
-- STAFF
-- ============================================================================
ALTER TABLE staff ENABLE ROW LEVEL SECURITY;

CREATE POLICY tenant_isolation_select ON staff
  FOR SELECT
  USING (tenant_id = current_setting('app.current_tenant_id')::uuid);

CREATE POLICY tenant_isolation_insert ON staff
  FOR INSERT
  WITH CHECK (tenant_id = current_setting('app.current_tenant_id')::uuid);

CREATE POLICY tenant_isolation_update ON staff
  FOR UPDATE
  USING (tenant_id = current_setting('app.current_tenant_id')::uuid)
  WITH CHECK (tenant_id = current_setting('app.current_tenant_id')::uuid);

CREATE POLICY tenant_isolation_delete ON staff
  FOR DELETE
  USING (tenant_id = current_setting('app.current_tenant_id')::uuid);

-- ============================================================================
-- ENROLLMENTS
-- ============================================================================
ALTER TABLE enrollments ENABLE ROW LEVEL SECURITY;

CREATE POLICY tenant_isolation_select ON enrollments
  FOR SELECT
  USING (tenant_id = current_setting('app.current_tenant_id')::uuid);

CREATE POLICY tenant_isolation_insert ON enrollments
  FOR INSERT
  WITH CHECK (tenant_id = current_setting('app.current_tenant_id')::uuid);

CREATE POLICY tenant_isolation_update ON enrollments
  FOR UPDATE
  USING (tenant_id = current_setting('app.current_tenant_id')::uuid)
  WITH CHECK (tenant_id = current_setting('app.current_tenant_id')::uuid);

CREATE POLICY tenant_isolation_delete ON enrollments
  FOR DELETE
  USING (tenant_id = current_setting('app.current_tenant_id')::uuid);

-- ============================================================================
-- ACADEMIC PERIODS
-- ============================================================================
ALTER TABLE academic_periods ENABLE ROW LEVEL SECURITY;

CREATE POLICY tenant_isolation_select ON academic_periods
  FOR SELECT
  USING (tenant_id = current_setting('app.current_tenant_id')::uuid);

CREATE POLICY tenant_isolation_insert ON academic_periods
  FOR INSERT
  WITH CHECK (tenant_id = current_setting('app.current_tenant_id')::uuid);

CREATE POLICY tenant_isolation_update ON academic_periods
  FOR UPDATE
  USING (tenant_id = current_setting('app.current_tenant_id')::uuid)
  WITH CHECK (tenant_id = current_setting('app.current_tenant_id')::uuid);

CREATE POLICY tenant_isolation_delete ON academic_periods
  FOR DELETE
  USING (tenant_id = current_setting('app.current_tenant_id')::uuid);

-- ============================================================================
-- GRADES
-- ============================================================================
ALTER TABLE grades ENABLE ROW LEVEL SECURITY;

CREATE POLICY tenant_isolation_select ON grades
  FOR SELECT
  USING (tenant_id = current_setting('app.current_tenant_id')::uuid);

CREATE POLICY tenant_isolation_insert ON grades
  FOR INSERT
  WITH CHECK (tenant_id = current_setting('app.current_tenant_id')::uuid);

CREATE POLICY tenant_isolation_update ON grades
  FOR UPDATE
  USING (tenant_id = current_setting('app.current_tenant_id')::uuid)
  WITH CHECK (tenant_id = current_setting('app.current_tenant_id')::uuid);

CREATE POLICY tenant_isolation_delete ON grades
  FOR DELETE
  USING (tenant_id = current_setting('app.current_tenant_id')::uuid);

-- ============================================================================
-- CLASSES
-- ============================================================================
ALTER TABLE classes ENABLE ROW LEVEL SECURITY;

CREATE POLICY tenant_isolation_select ON classes
  FOR SELECT
  USING (tenant_id = current_setting('app.current_tenant_id')::uuid);

CREATE POLICY tenant_isolation_insert ON classes
  FOR INSERT
  WITH CHECK (tenant_id = current_setting('app.current_tenant_id')::uuid);

CREATE POLICY tenant_isolation_update ON classes
  FOR UPDATE
  USING (tenant_id = current_setting('app.current_tenant_id')::uuid)
  WITH CHECK (tenant_id = current_setting('app.current_tenant_id')::uuid);

CREATE POLICY tenant_isolation_delete ON classes
  FOR DELETE
  USING (tenant_id = current_setting('app.current_tenant_id')::uuid);

-- ============================================================================
-- BYPASS POLICY FOR SUPERUSER / SERVICE ROLE
-- ============================================================================
-- The application connects as a non-superuser role. Superusers bypass RLS by default.
-- For service-level operations (migrations, provisioning), use a superuser connection
-- or explicitly bypass RLS with: SET ROLE postgres;
--
-- To allow the application role to bypass RLS for provisioning operations,
-- we grant the BYPASSRLS attribute only to the migration/provisioning role.
-- The normal application role does NOT have BYPASSRLS.
