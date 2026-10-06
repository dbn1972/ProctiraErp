-- PRC-M210 — remap legacy institution_infrastructure.condition values BEFORE 106.
--
-- 106_institution_repair_requests.sql runs its legacy-value UPDATE while FORCE
-- ROW LEVEL SECURITY is on. The tenant_isolation policy (027) only matches rows
-- of the bound app.tenant_id, and a migration session binds none, so a
-- non-BYPASSRLS owner updates 0 rows; 106 then lifts FORCE only for VALIDATE,
-- which scans the real (unmapped) rows and aborts the migration.
--
-- 106 is checksum-ledgered and cannot be edited, and a later-numbered fix would
-- never run on a database stuck at 106. This file sorts before 106 (LC_ALL=C:
-- "105a_" < "106_", same convention as 021a) so the remap happens with FORCE
-- lifted, then asserts no row would violate 106's CHECK. On databases that
-- already applied 106 it is a no-op (the CHECK already holds).
--
-- Mapping is identical to 106. Idempotent. Needs DB review (FORCE RLS lift).

DO $remap_institution_condition$
DECLARE
  was_forced boolean;
  bad        bigint;
BEGIN
  IF to_regclass('public.institution_infrastructure') IS NULL THEN
    RETURN;
  END IF;

  SELECT relforcerowsecurity
    INTO was_forced
    FROM pg_class
   WHERE oid = 'public.institution_infrastructure'::regclass;

  IF was_forced THEN
    ALTER TABLE institution_infrastructure NO FORCE ROW LEVEL SECURITY;
  END IF;

  UPDATE institution_infrastructure
     SET condition = CASE
       WHEN condition IN ('Good', 'Fair', 'Needs repair', 'Unknown') THEN condition
       WHEN upper(condition) IN ('GOOD', 'AVAILABLE', 'NEW') THEN 'Good'
       WHEN upper(condition) IN ('FAIR', 'AVERAGE') THEN 'Fair'
       WHEN upper(condition) LIKE '%REPAIR%'
         OR upper(condition) IN ('POOR', 'DAMAGED', 'BAD') THEN 'Needs repair'
       ELSE 'Unknown'
     END
   WHERE condition IS NOT NULL
     AND condition NOT IN ('Good', 'Fair', 'Needs repair', 'Unknown');

  SELECT count(*)
    INTO bad
    FROM institution_infrastructure
   WHERE condition IS NOT NULL
     AND condition NOT IN ('Good', 'Fair', 'Needs repair', 'Unknown');

  IF was_forced THEN
    ALTER TABLE institution_infrastructure FORCE ROW LEVEL SECURITY;
  END IF;

  IF bad > 0 THEN
    RAISE EXCEPTION 'PRC-M210: % institution_infrastructure rows still violate the condition set', bad;
  END IF;
END
$remap_institution_condition$;

INSERT INTO schema_migrations (filename)
VALUES ('105a_institution_condition_legacy_remap.sql')
ON CONFLICT (filename) DO NOTHING;
