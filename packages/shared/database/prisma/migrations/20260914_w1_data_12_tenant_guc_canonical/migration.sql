-- Prisma mirror of db/sql/071_tenant_guc_canonical.sql (W1-DATA-12).
-- Keep in sync when editing the numbered SQL file.

-- W1-DATA-12: Canonicalize tenant RLS GUC on app.tenant_id
--
-- Problem: policies historically read either `app.tenant_id` (raw SQL) or
-- `app.current_tenant_id` (early Prisma). Callers that bound only one name
-- silently failed the other policy set.
--
-- Fix:
--   1. `app_tenant_id()` — effective tenant reader (canonical first, legacy alias)
--   2. `set_app_tenant_id(text)` — writer that sets canonical + syncs legacy
--   3. Rewrite existing public policies that reference either GUC to use
--      `app_tenant_id()` so a single bind is sufficient for all tables.
--
-- Application code should use `@proctira/database` `bindTenantGuc` /
-- `withPgTenant` / `withTenantTransaction` (never hand-roll one GUC name).

CREATE OR REPLACE FUNCTION app_tenant_id()
RETURNS text
LANGUAGE sql
STABLE
PARALLEL SAFE
AS $$
  SELECT COALESCE(
    NULLIF(current_setting('app.tenant_id', true), ''),
    NULLIF(current_setting('app.current_tenant_id', true), '')
  );
$$;

COMMENT ON FUNCTION app_tenant_id() IS
  'W1-DATA-12: effective tenant for RLS; prefers app.tenant_id, aliases legacy app.current_tenant_id.';

CREATE OR REPLACE FUNCTION set_app_tenant_id(p_tenant text)
RETURNS text
LANGUAGE plpgsql
AS $$
BEGIN
  IF p_tenant IS NULL OR btrim(p_tenant) = '' THEN
    RAISE EXCEPTION 'set_app_tenant_id: tenant id must be non-empty';
  END IF;
  -- Canonical
  PERFORM set_config('app.tenant_id', p_tenant, true);
  -- Legacy alias sync (Prisma-era policies / residual callers)
  PERFORM set_config('app.current_tenant_id', p_tenant, true);
  RETURN p_tenant;
END;
$$;

COMMENT ON FUNCTION set_app_tenant_id(text) IS
  'W1-DATA-12: bind canonical app.tenant_id and sync legacy app.current_tenant_id.';

-- Runtime role must be able to call these (FORCE RLS paths).
DO $$
BEGIN
  IF EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'proctira_app') THEN
    EXECUTE 'GRANT EXECUTE ON FUNCTION app_tenant_id() TO proctira_app';
    EXECUTE 'GRANT EXECUTE ON FUNCTION set_app_tenant_id(text) TO proctira_app';
  END IF;
  EXECUTE 'GRANT EXECUTE ON FUNCTION app_tenant_id() TO PUBLIC';
  EXECUTE 'GRANT EXECUTE ON FUNCTION set_app_tenant_id(text) TO PUBLIC';
END $$;

-- ---------------------------------------------------------------------------
-- Rewrite policies that still key off either GUC spelling to app_tenant_id().
-- Idempotent: re-running replaces the same names with the same expressions.
-- ---------------------------------------------------------------------------
DO $$
DECLARE
  pol RECORD;
  using_expr text;
  check_expr text;
  cmd text;
  roles_sql text;
  new_using text;
  new_check text;
  changed boolean;
BEGIN
  FOR pol IN
    SELECT
      n.nspname AS schemaname,
      c.relname AS tablename,
      p.polname AS policyname,
      p.polcmd AS polcmd,
      pg_get_expr(p.polqual, p.polrelid) AS using_expr,
      pg_get_expr(p.polwithcheck, p.polrelid) AS check_expr,
      ARRAY(
        SELECT quote_ident(r.rolname)
        FROM unnest(p.polroles) AS oid(oid)
        JOIN pg_roles r ON r.oid = oid.oid
      ) AS role_names
    FROM pg_policy p
    JOIN pg_class c ON c.oid = p.polrelid
    JOIN pg_namespace n ON n.oid = c.relnamespace
    WHERE n.nspname = 'public'
      AND (
        COALESCE(pg_get_expr(p.polqual, p.polrelid), '') ~ 'app\.(tenant_id|current_tenant_id)'
        OR COALESCE(pg_get_expr(p.polwithcheck, p.polrelid), '') ~ 'app\.(tenant_id|current_tenant_id)'
      )
  LOOP
    using_expr := pol.using_expr;
    check_expr := pol.check_expr;
    changed := false;

    -- Normalize dual-COALESCE / single-GUC reads → app_tenant_id()
    FOREACH cmd IN ARRAY ARRAY['using', 'check']
    LOOP
      new_using := CASE WHEN cmd = 'using' THEN using_expr ELSE check_expr END;
      IF new_using IS NULL THEN
        CONTINUE;
      END IF;

      -- Dual COALESCE (either order of the two NULLIF arms)
      new_check := regexp_replace(
        new_using,
        'COALESCE\(\s*NULLIF\(current_setting\(''app\.tenant_id'',\s*true\),\s*''''\)\s*,\s*NULLIF\(current_setting\(''app\.current_tenant_id'',\s*true\),\s*''''\)\s*\)',
        'app_tenant_id()',
        'g'
      );
      new_check := regexp_replace(
        new_check,
        'COALESCE\(\s*NULLIF\(current_setting\(''app\.current_tenant_id'',\s*true\),\s*''''\)\s*,\s*NULLIF\(current_setting\(''app\.tenant_id'',\s*true\),\s*''''\)\s*\)',
        'app_tenant_id()',
        'g'
      );

      -- Legacy-only / canonical-only NULLIF(current_setting(...), '')
      new_check := regexp_replace(
        new_check,
        'NULLIF\(current_setting\(''app\.current_tenant_id'',\s*true\),\s*''''\)',
        'app_tenant_id()',
        'g'
      );
      new_check := regexp_replace(
        new_check,
        'NULLIF\(current_setting\(''app\.tenant_id'',\s*true\),\s*''''\)',
        'app_tenant_id()',
        'g'
      );

      -- Strict cast form from early Prisma migrations (no missing_ok / NULLIF)
      new_check := replace(
        new_check,
        'current_setting(''app.current_tenant_id'')::uuid',
        'NULLIF(app_tenant_id(), '''')::uuid'
      );
      new_check := replace(
        new_check,
        'current_setting(''app.tenant_id'')::uuid',
        'NULLIF(app_tenant_id(), '''')::uuid'
      );

      IF new_check IS DISTINCT FROM new_using THEN
        changed := true;
        IF cmd = 'using' THEN
          using_expr := new_check;
        ELSE
          check_expr := new_check;
        END IF;
      END IF;
    END LOOP;

    IF NOT changed THEN
      CONTINUE;
    END IF;

    CASE pol.polcmd
      WHEN 'r' THEN cmd := 'SELECT';
      WHEN 'a' THEN cmd := 'INSERT';
      WHEN 'w' THEN cmd := 'UPDATE';
      WHEN 'd' THEN cmd := 'DELETE';
      WHEN '*' THEN cmd := 'ALL';
      ELSE cmd := 'ALL';
    END CASE;

    IF pol.role_names IS NULL OR cardinality(pol.role_names) = 0 THEN
      roles_sql := 'PUBLIC';
    ELSE
      roles_sql := array_to_string(pol.role_names, ', ');
    END IF;

    EXECUTE format('DROP POLICY IF EXISTS %I ON %I.%I', pol.policyname, pol.schemaname, pol.tablename);

    IF using_expr IS NOT NULL AND check_expr IS NOT NULL THEN
      EXECUTE format(
        'CREATE POLICY %I ON %I.%I AS PERMISSIVE FOR %s TO %s USING (%s) WITH CHECK (%s)',
        pol.policyname, pol.schemaname, pol.tablename, cmd, roles_sql, using_expr, check_expr
      );
    ELSIF using_expr IS NOT NULL THEN
      EXECUTE format(
        'CREATE POLICY %I ON %I.%I AS PERMISSIVE FOR %s TO %s USING (%s)',
        pol.policyname, pol.schemaname, pol.tablename, cmd, roles_sql, using_expr
      );
    ELSIF check_expr IS NOT NULL THEN
      EXECUTE format(
        'CREATE POLICY %I ON %I.%I AS PERMISSIVE FOR %s TO %s WITH CHECK (%s)',
        pol.policyname, pol.schemaname, pol.tablename, cmd, roles_sql, check_expr
      );
    END IF;
  END LOOP;
END $$;
