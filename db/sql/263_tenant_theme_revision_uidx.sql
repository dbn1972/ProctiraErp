-- PRC-M389: tenant theme versions live in control_plane_documents
-- (collection 'tenant.theme_versions', PgTenantRepository). insertThemeVersion
-- read the tenant's max revision and then inserted max + 1, so two parallel
-- publishes minted the same revision. The tenant_theme_versions table's
-- UNIQUE (tenant_id, revision) (Prisma 20250524) does not apply: the PG
-- repository never writes that table. control_plane_documents' only key is
-- PRIMARY KEY (collection, id).
--
-- The repository now allocates under pg_advisory_xact_lock per tenant, and
-- this partial unique index makes a duplicate revision impossible for any
-- writer. Only theme-version documents participate (WHERE collection = ...),
-- so no other collection is constrained.
--
-- Invariant: per tenant, at most one 'tenant.theme_versions' document per
-- integer data->>'revision'.
--
-- control_plane_documents is FORCE RLS (022). The preflight reads under
-- app.platform_admin = '1', which the existing tenant_isolation policy admits,
-- so FORCE is never lifted. It refuses to build over duplicate or non-integer
-- revisions (never deletes data). The index build itself is not subject to RLS.
--
-- Every statement is idempotent; CONCURRENTLY makes apply-sql.sh run this file
-- statement-by-statement via schema_migration_phases (each DO is its own
-- transaction, so the set_config below is transaction-local).
-- Rollback (future forward migration):
--   DROP INDEX IF EXISTS control_plane_documents_theme_revision_uidx;
DO $m389_preflight$
DECLARE
  bad_revisions bigint;
  duplicate_groups bigint;
BEGIN
  PERFORM set_config('app.platform_admin', '1', true);
  SELECT count(*) INTO bad_revisions
    FROM control_plane_documents
   WHERE collection = 'tenant.theme_versions'
     AND COALESCE(data->>'revision', '') !~ '^-?[0-9]{1,9}$';
  IF bad_revisions > 0 THEN
    RAISE EXCEPTION
      'PRC-M389: % tenant.theme_versions document(s) have a missing or non-integer revision; reconcile before re-running',
      bad_revisions;
  END IF;
  SELECT count(*) INTO duplicate_groups
    FROM (
      SELECT tenant_id, (data->>'revision')::int
        FROM control_plane_documents
       WHERE collection = 'tenant.theme_versions'
       GROUP BY 1, 2
      HAVING count(*) > 1
    ) d;
  IF duplicate_groups > 0 THEN
    RAISE EXCEPTION
      'PRC-M389: % duplicate (tenant_id, revision) theme-version group(s) exist; reconcile before re-running',
      duplicate_groups;
  END IF;
END
$m389_preflight$;
DO $m389_drop_invalid$
BEGIN
  IF EXISTS (
    SELECT 1
      FROM pg_class c
      JOIN pg_namespace n ON n.oid = c.relnamespace
      JOIN pg_index i ON i.indexrelid = c.oid
     WHERE n.nspname = 'public'
       AND c.relname = 'control_plane_documents_theme_revision_uidx'
       AND NOT i.indisvalid
  ) THEN
    RAISE NOTICE 'dropping invalid control_plane_documents_theme_revision_uidx before rebuild';
    EXECUTE 'DROP INDEX IF EXISTS public.control_plane_documents_theme_revision_uidx';
  END IF;
END
$m389_drop_invalid$;
CREATE UNIQUE INDEX CONCURRENTLY IF NOT EXISTS control_plane_documents_theme_revision_uidx
  ON control_plane_documents (tenant_id, ((data->>'revision')::int))
  WHERE collection = 'tenant.theme_versions';
DO $m389_assert$
BEGIN
  IF NOT EXISTS (
    SELECT 1
      FROM pg_class c
      JOIN pg_namespace n ON n.oid = c.relnamespace
      JOIN pg_index i ON i.indexrelid = c.oid
     WHERE n.nspname = 'public'
       AND c.relname = 'control_plane_documents_theme_revision_uidx'
       AND i.indisvalid
       AND i.indisunique
  ) THEN
    RAISE EXCEPTION 'PRC-M389: control_plane_documents_theme_revision_uidx missing or INVALID';
  END IF;
END
$m389_assert$;
