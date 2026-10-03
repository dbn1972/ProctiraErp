-- PRC-H099: tenants.status lifecycle CHECK, including 'provisioning_failed'.
--
-- tenants.status was VARCHAR(20) with no CHECK, so any string could land there
-- (pg-tenant-repository refuses to resolve unknown values, but nothing stopped
-- the write). The tenant provisioner needs a terminal 'provisioning_failed'
-- state for a create that rolled back part-way, so this adds the CHECK with the
-- full lifecycle set:
--   provisioning -> active | provisioning_failed ; active <-> suspended ;
--   * -> decommissioned
-- Values mirror TenantEntity['status'] (packages/backend/tenant) plus the new
-- 'provisioning_failed'.
--
-- tenants is Prisma-owned (mirrorOk). A CHECK is not representable in Prisma and
-- is not part of the W1-DATA-04 parity set, so it is added here, like the RLS
-- policies in 021.
--
-- Data safety: added NOT VALID (new writes checked immediately). Existing rows are
-- then validated with FORCE ROW LEVEL SECURITY lifted for the scan and restored in
-- the same transaction. If any existing row holds a value outside the set, the
-- constraint is left NOT VALID with a WARNING naming the count instead of failing
-- the deploy; no row is rewritten. Idempotent.
--
-- Rollback: forward-only; a later migration may DROP CONSTRAINT tenants_status_check.

ALTER TABLE tenants DROP CONSTRAINT IF EXISTS tenants_status_check;
ALTER TABLE tenants
  ADD CONSTRAINT tenants_status_check
  CHECK (status IN (
    'provisioning', 'provisioning_failed', 'active', 'suspended', 'decommissioned'
  )) NOT VALID;

DO $h099_validate$
DECLARE
  was_forced boolean;
  bad_rows bigint;
BEGIN
  SELECT relforcerowsecurity INTO was_forced
    FROM pg_class WHERE oid = 'public.tenants'::regclass;
  IF was_forced THEN
    ALTER TABLE tenants NO FORCE ROW LEVEL SECURITY;
  END IF;

  SELECT count(*) INTO bad_rows
    FROM tenants
   WHERE status IS NULL
      OR status NOT IN (
        'provisioning', 'provisioning_failed', 'active', 'suspended', 'decommissioned'
      );

  IF bad_rows = 0 THEN
    ALTER TABLE tenants VALIDATE CONSTRAINT tenants_status_check;
  ELSE
    RAISE WARNING
      'PRC-H099: % tenants row(s) have a status outside the lifecycle set; '
      'tenants_status_check left NOT VALID (new writes are still checked). '
      'Correct those rows, then VALIDATE CONSTRAINT tenants_status_check.',
      bad_rows;
  END IF;

  IF was_forced THEN
    ALTER TABLE tenants FORCE ROW LEVEL SECURITY;
  END IF;
END
$h099_validate$;
