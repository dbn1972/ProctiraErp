-- =============================================================================
-- E2E tenant fixtures (G-706)
-- =============================================================================
-- The Playwright live smokes (apps/web/e2e/*.spec.ts) mint HS256 cookies for a
-- fixed set of tenant ids. With G-718 strict tenant FKs (APPLY_STRICT_FKS=1)
-- and G-732 FORCE RLS on `tenants`, those ids must exist as real tenant rows
-- before any domain write succeeds. This file is idempotent and applied by
-- tools/scripts/run-e2e-backend-ready.sh before api-gateway starts.
--
-- FORCE RLS: inserting into `tenants` requires the platform-admin scope, bound
-- transaction-locally here so it never leaks into the session.
-- =============================================================================
BEGIN;
DO $$ BEGIN PERFORM set_config('app.platform_admin', '1', true); END $$;

INSERT INTO tenants (id, name, slug, config, status)
VALUES
  ('00000000-0000-4000-8000-000000000001', 'E2E Tenant A (demo)',        'e2e-tenant-a',       '{}'::jsonb, 'active'),
  ('00000000-0000-4000-8000-0000000000aa', 'E2E Tenant AA (health)',     'e2e-tenant-aa',      '{}'::jsonb, 'active'),
  ('00000000-0000-4000-8000-0000000000bb', 'E2E Tenant B (isolation)',   'e2e-tenant-bb',      '{}'::jsonb, 'active'),
  ('00000000-0000-4000-8000-000000000032', 'E2E Tenant 32 (services)',   'e2e-tenant-32',      '{}'::jsonb, 'active'),
  ('00000000-0000-4000-8000-000000000094', 'E2E Tenant 94 (attendance)', 'e2e-tenant-94',      '{}'::jsonb, 'active'),
  ('00000000-0000-4000-8000-000000000096', 'E2E Tenant 96 (staff)',      'e2e-tenant-96',      '{}'::jsonb, 'active'),
  ('00000000-0000-4000-8000-000000000098', 'E2E Tenant 98 (student)',    'e2e-tenant-98',      '{}'::jsonb, 'active'),
  ('00000000-0000-4000-8000-000000000099', 'E2E Tenant 99 (assessment)', 'e2e-tenant-99',      '{}'::jsonb, 'active')
ON CONFLICT (id) DO UPDATE
  SET status = 'active',
      deleted_at = NULL,
      updated_at = now();

COMMIT;
