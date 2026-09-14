-- W1-DATA-06 / G-718 — prerequisite tenant rows for strict tenant FKs.
--
-- Opt-in with APPLY_STRICT_FKS=1 (same gate as 021b). Demo *b_*_seed.sql files
-- insert rows under the well-known local/dev tenant UUID below *before* 021b
-- adds NOT VALID FKs. VALIDATE (068) requires that UUID to exist in tenants.
--
-- FORCE RLS on tenants: bind platform-admin for the insert only.

DO $$ BEGIN
  PERFORM set_config('app.platform_admin', '1', true);
END $$;

INSERT INTO tenants (id, name, slug, config, status)
VALUES (
  '00000000-0000-4000-8000-000000000001',
  'Strict-FK demo tenant',
  'strict-fk-demo',
  '{}'::jsonb,
  'active'
)
ON CONFLICT (id) DO UPDATE
  SET status = 'active',
      deleted_at = NULL,
      updated_at = NOW();

INSERT INTO schema_migrations (filename)
VALUES ('021a_strict_fk_prerequisite_tenants.sql')
ON CONFLICT (filename) DO NOTHING;
