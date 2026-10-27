-- PRC-L557: `periods` (003:150-163) is a compatibility view over bell_periods,
-- an RLS table, created without security_invoker (no later file sets it). A
-- view without security_invoker reads its base table with the view OWNER's
-- rights. With the CI/production roles the owner (migrator) is NOBYPASSRLS and
-- bell_periods is FORCE RLS, so the tenant policy still applied; but under any
-- owner with BYPASSRLS (a superuser restore, a managed-service admin role) the
-- view becomes a cross-tenant read for every role granted SELECT on it.
--
-- security_invoker = true (PG15+; CI and compose run postgres:16) makes the
-- view evaluate the base-table RLS as the calling role, independent of who
-- owns it. This only adds enforcement; it weakens nothing.
--
-- Guarded on to_regclass so a database without the view (it is a
-- compatibility alias) is a no-op. Idempotent: SET of a reloption.
-- Invariant: public.periods reloptions contain security_invoker=true.
-- Rollback (future forward migration):
--   ALTER VIEW periods RESET (security_invoker);
DO $l557_periods_invoker$
BEGIN
  IF to_regclass('public.periods') IS NOT NULL THEN
    ALTER VIEW public.periods SET (security_invoker = true);
  END IF;
END
$l557_periods_invoker$;
