-- PRC-L462: idempotency snapshot for the Sunrise demo seed.
--
-- Emits one `table=count` line per public table that (a) has a tenant_id
-- column and (b) currently holds at least one row for the Sunrise demo
-- tenant. Run this immediately after db/seeds/006_sunrise_public_school_demo.sql
-- a first time, then after a re-apply, and diff the two outputs: they MUST be
-- identical. A difference means the seed is not idempotent (e.g. a single-use
-- teardown that leaves stale rows on re-run, the exact hygiene defect
-- PRC-L462 closes).
--
-- The tenant GUC is bound transaction-locally (set_config(..., true)) in the
-- same transaction as the counts so FORCE RLS lets the migrator read every
-- tenant-scoped table (students, sections, section_meetings, fee_*, rooms,
-- attendance, gradebook, scholarships, facilities, …), not just the handful
-- whose policies happen to read a different predicate. Platform-admin scope is
-- set the same way the demo seed binds it.
--
-- Usage:
--   psql "$MIGRATOR_DATABASE_URL" -v ON_ERROR_STOP=1 -q -t -A \
--     -f db/seeds/006_sunrise_demo_rowcounts.sql

\set ON_ERROR_STOP on
\set tid '00000000-0000-4000-8000-00000000a501'

BEGIN;

-- Bind tenant scope transaction-locally; suppress these helpers' output so the
-- only rows printed are the `table=count` lines consumed by the idempotency diff.
\o /dev/null
SELECT set_config('app.platform_admin', '1', true);
SELECT set_app_tenant_id(:'tid');
\o

DO $$
DECLARE
  r record;
  n bigint;
BEGIN
  CREATE TEMP TABLE _sunrise_rowcounts(line text) ON COMMIT DROP;
  FOR r IN
    SELECT table_name
      FROM information_schema.columns
     WHERE table_schema = 'public'
       AND column_name = 'tenant_id'
     ORDER BY table_name
  LOOP
    EXECUTE format(
      'SELECT count(*) FROM public.%I WHERE tenant_id = %L::uuid',
      r.table_name, '00000000-0000-4000-8000-00000000a501'
    ) INTO n;
    IF n > 0 THEN
      INSERT INTO _sunrise_rowcounts(line) VALUES (r.table_name || '=' || n::text);
    END IF;
  END LOOP;
END $$;

SELECT line FROM _sunrise_rowcounts ORDER BY line;

COMMIT;
