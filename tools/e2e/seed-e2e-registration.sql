-- =============================================================================
-- E2E registration fixture (UAT-API-004 / PRC-M568)
-- =============================================================================
-- Test-only data for the registration-portal live submit -> track journey
-- (apps/registration-portal/e2e/03-registration-live-journey.spec.ts). Applied
-- by tools/scripts/run-e2e-registration-live.sh before api-gateway starts. Not a
-- db/seeds file: CI and local E2E only, never production.
--
-- Seeds one active tenant (resolved from the public Host `<slug>.<base domain>`),
-- one active institution and one published v1 admission form with no custom
-- fields, so no field or document is required.
--
-- Run as the migrator (MIGRATOR_DATABASE_URL): no grant, RLS or schema change.
-- FORCE RLS scopes are bound transaction-locally, as in seed-e2e-tenants.sql.
-- Idempotent: rerunning leaves exactly the same published form (the form table
-- is append-only, so the v1 row is inserted once and never updated).
--
--   psql "$MIGRATOR_DATABASE_URL" -v ON_ERROR_STOP=1 \
--     -v tenant_id=<uuid> -v slug=<dns label> -v institution_id=<uuid> \
--     -f tools/e2e/seed-e2e-registration.sql
-- =============================================================================
\set ON_ERROR_STOP on

BEGIN;
SELECT set_config('app.platform_admin', '1', true);
SELECT set_config('app.tenant_id', :'tenant_id', true);
-- psql does not expand :vars inside the DO body below; pass the id this way.
SELECT set_config('e2e.registration_institution_id', :'institution_id', true);

INSERT INTO tenants (id, name, slug, config, status)
VALUES (:'tenant_id'::uuid, 'E2E Registration Tenant', :'slug', '{}'::jsonb, 'active')
ON CONFLICT (id) DO UPDATE
  SET status = 'active',
      deleted_at = NULL,
      updated_at = now();

INSERT INTO geographic_areas (id, tenant_id, name, code, level, parent_id, path, lft, rgt)
VALUES (
  '00000000-0000-4000-8000-00000000e0a1', :'tenant_id'::uuid,
  'E2E Registration District', 'E2E-REG-DIST', 1, NULL, '/E2E-REG-DIST', 1, 2
)
ON CONFLICT (id) DO UPDATE
  SET deleted_at = NULL,
      updated_at = now()
  WHERE geographic_areas.tenant_id = EXCLUDED.tenant_id;

INSERT INTO institutions (id, tenant_id, name, code, area_id, type, sector, ownership, status, custom_data)
VALUES (
  :'institution_id'::uuid, :'tenant_id'::uuid,
  'E2E Registration School', 'E2E-REG-001',
  '00000000-0000-4000-8000-00000000e0a1',
  'school', 'public', 'government', 'active', '{}'::jsonb
)
ON CONFLICT (id) DO UPDATE
  SET status = 'active',
      deleted_at = NULL,
      updated_at = now()
  WHERE institutions.tenant_id = EXCLUDED.tenant_id;

-- Published v1, no custom fields and therefore no required documents.
INSERT INTO admission_form_configurations (id, tenant_id, institution_id, version, fields, published_at)
VALUES (gen_random_uuid(), :'tenant_id'::uuid, :'institution_id'::uuid, 1, '[]'::jsonb, now())
ON CONFLICT (tenant_id, institution_id, version) DO NOTHING;

-- Fail closed if the fixture is not in the state the journey needs (for
-- example a slug or institution id already owned by another tenant, or a
-- later form version with fields).
DO $verify$
DECLARE
  v_tenant uuid := current_setting('app.tenant_id')::uuid;
  v_institution uuid := current_setting('e2e.registration_institution_id')::uuid;
  v_ok boolean;
BEGIN
  SELECT EXISTS (
           SELECT 1 FROM tenants t
            WHERE t.id = v_tenant AND t.status = 'active' AND t.deleted_at IS NULL)
     AND EXISTS (
           SELECT 1 FROM institutions i
            WHERE i.id = v_institution AND i.tenant_id = v_tenant
              AND lower(i.status) = 'active' AND i.deleted_at IS NULL)
     AND (SELECT c.fields = '[]'::jsonb AND c.published_at IS NOT NULL
            FROM admission_form_configurations c
           WHERE c.tenant_id = v_tenant AND c.institution_id = v_institution
           ORDER BY c.version DESC
           LIMIT 1)
    INTO v_ok;
  IF v_ok IS NOT TRUE THEN
    RAISE EXCEPTION 'E2E registration fixture is not seeded as required (tenant %, institution %)',
      v_tenant, v_institution;
  END IF;
END
$verify$;
COMMIT;
