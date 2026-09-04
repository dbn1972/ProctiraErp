-- Phase 2: service-owned PostgreSQL schemas (charter §19).
-- platform = tenants + themes; auth = identity projection; public = remaining domains.
-- Auth tables keep tenant_id as a bare UUID — no FK into platform.tenants (no cross-service joins).

CREATE SCHEMA IF NOT EXISTS platform;
CREATE SCHEMA IF NOT EXISTS auth;

-- Move platform tables first (tenants referenced by public-domain FKs remain valid cross-schema).
ALTER TABLE IF EXISTS public.tenants SET SCHEMA platform;
ALTER TABLE IF EXISTS public.tenant_theme_versions SET SCHEMA platform;
ALTER TABLE IF EXISTS public.tenant_theme_drafts SET SCHEMA platform;

-- Drop auth → tenants foreign keys before moving auth tables.
DO $$
DECLARE
  r record;
BEGIN
  FOR r IN
    SELECT c.conname, n.nspname AS schema_name, t.relname AS table_name
    FROM pg_constraint c
    JOIN pg_class t ON t.oid = c.conrelid
    JOIN pg_namespace n ON n.oid = t.relnamespace
    JOIN pg_class ft ON ft.oid = c.confrelid
    JOIN pg_namespace fn ON fn.oid = ft.relnamespace
    WHERE c.contype = 'f'
      AND n.nspname = 'public'
      AND t.relname IN ('users', 'user_identities', 'refresh_tokens', 'user_sessions')
      AND fn.nspname IN ('public', 'platform')
      AND ft.relname = 'tenants'
  LOOP
    EXECUTE format('ALTER TABLE %I.%I DROP CONSTRAINT %I', r.schema_name, r.table_name, r.conname);
  END LOOP;
END $$;

ALTER TABLE IF EXISTS public.users SET SCHEMA auth;
ALTER TABLE IF EXISTS public.user_identities SET SCHEMA auth;
ALTER TABLE IF EXISTS public.refresh_tokens SET SCHEMA auth;
ALTER TABLE IF EXISTS public.user_sessions SET SCHEMA auth;

-- Ensure search_path-aware apps still resolve unqualified names during transition.
-- Application code should prefer schema-qualified Prisma models.

-- Validation helpers (run manually on EC3):
--   SELECT count(*) FROM auth.users;
--   SELECT count(*) FROM auth.user_identities WHERE provider = 'keycloak';
--   SELECT conname FROM pg_constraint c
--     JOIN pg_class t ON t.oid = c.conrelid
--     JOIN pg_namespace n ON n.oid = t.relnamespace
--     JOIN pg_class ft ON ft.oid = c.confrelid
--     JOIN pg_namespace fn ON fn.oid = ft.relnamespace
--    WHERE c.contype = 'f' AND n.nspname = 'auth'
--      AND fn.nspname IN ('public') AND ft.relname IN ('students', 'institutions');
--   -- expect 0 rows
