-- PRC-L091: RLS policies compare tenant_id::text to the tenant GUC, so a query
-- that relies on RLS alone (no explicit `tenant_id = $1`) cannot use the
-- tenant_id btree indexes: the planner cannot turn `tenant_id::text = X` into
-- an index condition on the uuid column, and falls back to a full scan.
--
-- Fix:
--   1. app_tenant_uuid(): the canonical app.tenant_id GUC as uuid, or NULL when
--      it is unset, empty or not a lowercase canonical uuid. It never raises,
--      so a malformed GUC still denies instead of failing with 22P02 (the
--      PRC-L294 rule; tools/scripts/check-rls-uuid-cast.mjs does not flag it).
--      Only the lowercase hyphenated form converts, which is exactly the set
--      of strings `tenant_id::text` can equal, so the match set is unchanged.
--   2. Every policy on a uuid tenant_id table that contains the text compare
--      ((tenant_id)::text = NULLIF(current_setting('app.tenant_id'::text,
--      true), ''::text)) gets that term replaced by (tenant_id =
--      app_tenant_uuid()). Other terms (platform_admin branches), the command,
--      roles and PERMISSIVE/RESTRICTIVE kind are kept: ALTER POLICY changes
--      only the expressions, and a clause that was absent stays absent.
--      ENABLE + FORCE ROW LEVEL SECURITY are not touched and are asserted below.
--
-- Not rewritten: policies already on app_tenant_id() (they also read the
-- legacy app.current_tenant_id alias, which app_tenant_uuid() does not) and
-- the tenants table's own (id)::text policy.
--
-- Additive and idempotent: CREATE OR REPLACE, and the rewrite only matches the
-- old text term, so a re-run finds nothing to change.
CREATE OR REPLACE FUNCTION app_tenant_uuid()
RETURNS uuid
LANGUAGE sql
STABLE
PARALLEL SAFE
AS $$
  SELECT CASE
    WHEN current_setting('app.tenant_id', true)
         ~ '^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$'
    THEN current_setting('app.tenant_id', true)::uuid
  END;
$$;
COMMENT ON FUNCTION app_tenant_uuid() IS
  'PRC-L091: app.tenant_id as uuid, NULL when unset/empty/not a lowercase canonical uuid (never raises). Index-friendly RLS predicate: tenant_id = app_tenant_uuid().';
DO $$
BEGIN
  IF EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'proctira_app') THEN
    EXECUTE 'GRANT EXECUTE ON FUNCTION app_tenant_uuid() TO proctira_app';
  END IF;
  EXECUTE 'GRANT EXECUTE ON FUNCTION app_tenant_uuid() TO PUBLIC';
END $$;
DO $prc_l091_rewrite$
DECLARE
  old_term CONSTANT text :=
    '((tenant_id)::text = NULLIF(current_setting(''app.tenant_id''::text, true), ''''::text))';
  new_term CONSTANT text := '(tenant_id = app_tenant_uuid())';
  pol record;
  clauses text;
  rewritten int := 0;
  leftover text;
  unforced text;
BEGIN
  FOR pol IN
    SELECT c.relname AS tablename,
           p.polname AS policyname,
           pg_get_expr(p.polqual, p.polrelid) AS qual,
           pg_get_expr(p.polwithcheck, p.polrelid) AS with_check
      FROM pg_policy p
      JOIN pg_class c ON c.oid = p.polrelid
      JOIN pg_namespace n ON n.oid = c.relnamespace
      JOIN pg_attribute a ON a.attrelid = c.oid AND a.attname = 'tenant_id' AND NOT a.attisdropped
     WHERE n.nspname = 'public'
       AND a.atttypid = 'uuid'::regtype
       AND (strpos(coalesce(pg_get_expr(p.polqual, p.polrelid), ''), old_term) > 0
            OR strpos(coalesce(pg_get_expr(p.polwithcheck, p.polrelid), ''), old_term) > 0)
     ORDER BY c.relname, p.polname
  LOOP
    clauses := '';
    IF pol.qual IS NOT NULL THEN
      clauses := clauses || format(' USING (%s)', replace(pol.qual, old_term, new_term));
    END IF;
    IF pol.with_check IS NOT NULL THEN
      clauses := clauses || format(' WITH CHECK (%s)', replace(pol.with_check, old_term, new_term));
    END IF;
    EXECUTE format('ALTER POLICY %I ON public.%I', pol.policyname, pol.tablename) || clauses;
    rewritten := rewritten + 1;
  END LOOP;

  -- Fail loudly if any policy on a uuid tenant_id table still has the text term.
  SELECT string_agg(c.relname || '.' || p.polname, ', ' ORDER BY c.relname, p.polname)
    INTO leftover
    FROM pg_policy p
    JOIN pg_class c ON c.oid = p.polrelid
    JOIN pg_namespace n ON n.oid = c.relnamespace
    JOIN pg_attribute a ON a.attrelid = c.oid AND a.attname = 'tenant_id' AND NOT a.attisdropped
   WHERE n.nspname = 'public'
     AND a.atttypid = 'uuid'::regtype
     AND (strpos(coalesce(pg_get_expr(p.polqual, p.polrelid), ''), old_term) > 0
          OR strpos(coalesce(pg_get_expr(p.polwithcheck, p.polrelid), ''), old_term) > 0);
  IF leftover IS NOT NULL THEN
    RAISE EXCEPTION 'PRC-L091: text tenant compare still present on: %', leftover;
  END IF;

  -- ALTER POLICY never changes ENABLE/FORCE; prove it for every table with a
  -- tenant policy that now uses the helper.
  SELECT string_agg(DISTINCT c.relname, ', ')
    INTO unforced
    FROM pg_policy p
    JOIN pg_class c ON c.oid = p.polrelid
    JOIN pg_namespace n ON n.oid = c.relnamespace
   WHERE n.nspname = 'public'
     AND (strpos(coalesce(pg_get_expr(p.polqual, p.polrelid), ''), new_term) > 0
          OR strpos(coalesce(pg_get_expr(p.polwithcheck, p.polrelid), ''), new_term) > 0)
     AND NOT (c.relrowsecurity AND c.relforcerowsecurity);
  IF unforced IS NOT NULL THEN
    RAISE EXCEPTION 'PRC-L091: ENABLE/FORCE ROW LEVEL SECURITY missing on: %', unforced;
  END IF;
  RAISE NOTICE 'PRC-L091: % policies rewritten to tenant_id = app_tenant_uuid()', rewritten;
END
$prc_l091_rewrite$;
