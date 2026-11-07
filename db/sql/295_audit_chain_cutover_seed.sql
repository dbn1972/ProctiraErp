-- PRC-M200 — keyed HMAC audit chain: seed the per-tenant cut-over boundary.
--
-- 291 created audit_chain_cutover(tenant_id, cutover_seq): the head chain_seq
-- at which the keyed HMAC chain takes over from the legacy unkeyed sha256 chain.
-- The verifier accepts legacy unkeyed rows (key_id IS NULL) only at or below a
-- tenant's cutover_seq; every row with chain_seq > cutover_seq must carry a
-- known key_id and verify as HMAC-SHA256. The runtime role can never move a
-- cut-over (294 reclassified audit_chain_cutover to trigger_owned), so a
-- compromised app role cannot back-date forged "legacy" rows past the boundary.
--
-- This migration records the boundary ONCE, at migration time, from the current
-- state of each tenant's chain. Any row already chained before this deploy is
-- legacy unkeyed sha256 and is pinned below the cut-over; every row the keyed
-- write path (292/293) appends afterwards advances head_seq beyond it and must
-- be keyed.
--
-- Source of truth for "current head" is audit_chain_heads.head_seq, which 028
-- advances on every chained append. A tenant with chained rows but somehow no
-- head row (should not happen on a consistent base) is back-filled from the max
-- chain_seq across live + archive so no keyed row is ever left below the
-- boundary.
--
-- Idempotent: ON CONFLICT keeps the FIRST recorded cut-over (a re-apply must
-- never move an existing boundary forward — that would silently legitimise
-- rows written since the first apply).
--
-- FORCE RLS applies to the table owner (UAT-DB-003, B07 Q14). The migrator
-- (proctira) owns every table read and written here but is NOSUPERUSER
-- NOBYPASSRLS, and these tables are FORCE ROW LEVEL SECURITY (051). apply-sql
-- binds no app.tenant_id, so without a lift the source SELECTs see zero rows
-- and no tenant gets a cut-over; the keyed verifier would then reject every
-- legacy row of every existing tenant. Binding app.platform_admin would expose
-- the sources but not satisfy the audit_chain_cutover WITH CHECK, which has no
-- platform branch by design. So, as in db/sql/100, FORCE is lifted on the
-- source tables, on tenants (the join below) and on audit_chain_cutover for the
-- scan and insert, then restored where it was set. Everything runs in one DO
-- block inside apply-sql's per-file transaction: a failure rolls the lift back
-- with it, so no table can be left unforced. The ALTERs take ACCESS EXCLUSIVE
-- on these tables until commit, bounded by apply-sql's lock_timeout.
--
-- Tenant filter (B07 review issue 5). audit_chain_cutover.tenant_id is UUID
-- with a validated FK to tenants(id) (291, B07 Q2 option B). On the strict
-- posture (APPLY_STRICT_FKS=1, db/sql/100) the source tenant_id columns are
-- UUID with their own validated tenants FK, so every source tenant exists. In
-- the developer default they stay TEXT with no FK and can hold live-test
-- residue: a non-uuid value or a tenant that no longer exists. Such a row can
-- never be given a cut-over (the FK forbids it) and there is no tenant to
-- verify it for, so the seed joins tenants on the text form and skips it,
-- raising a WARNING with the count instead of aborting the deploy on a ::uuid
-- cast (22P02) or the FK (23503). A skipped id that later becomes a real
-- tenant has no cut-over, so the verifier treats its legacy rows as unkeyed
-- above cut-over 0 and fails closed.
DO $cutover_seed$
DECLARE
  t text;
  was_forced boolean;
  lifted text[] := ARRAY[]::text[];
  n_seeded bigint;
  n_backfilled bigint;
  n_skipped bigint;
BEGIN
  FOREACH t IN ARRAY ARRAY[
    'tenants', 'audit_chain_heads', 'audit_log_entries', 'audit_log_archive',
    'audit_chain_cutover'
  ] LOOP
    SELECT relforcerowsecurity INTO was_forced
      FROM pg_class WHERE oid = format('public.%I', t)::regclass;
    IF was_forced THEN
      EXECUTE format('ALTER TABLE %I NO FORCE ROW LEVEL SECURITY', t);
      lifted := lifted || t;
    END IF;
  END LOOP;

  -- 1) Seed from the authoritative per-tenant head.
  INSERT INTO audit_chain_cutover (tenant_id, cutover_seq)
  SELECT tn.id, h.head_seq
  FROM audit_chain_heads h
  JOIN tenants tn ON tn.id::text = h.tenant_id::text
  ON CONFLICT (tenant_id) DO NOTHING;
  GET DIAGNOSTICS n_seeded = ROW_COUNT;

  -- 2) Back-fill any tenant that has chained rows but no head row, from the
  --    highest chain_seq observed across live and archive. GROUP BY so each
  --    tenant yields one candidate; ON CONFLICT protects tenants seeded in (1).
  INSERT INTO audit_chain_cutover (tenant_id, cutover_seq)
  SELECT tn.id, max(s.chain_seq) AS cutover_seq
  FROM (
    SELECT tenant_id::text AS tenant_id, chain_seq FROM audit_log_entries WHERE chain_seq IS NOT NULL
    UNION ALL
    SELECT tenant_id::text AS tenant_id, chain_seq FROM audit_log_archive WHERE chain_seq IS NOT NULL
  ) s
  JOIN tenants tn ON tn.id::text = s.tenant_id
  GROUP BY tn.id
  ON CONFLICT (tenant_id) DO NOTHING;
  GET DIAGNOSTICS n_backfilled = ROW_COUNT;

  -- Chained tenant ids with no tenants row (developer-default residue only).
  SELECT count(*) INTO n_skipped
  FROM (
    SELECT tenant_id::text AS tenant_id FROM audit_chain_heads
    UNION
    SELECT tenant_id::text FROM audit_log_entries WHERE chain_seq IS NOT NULL
    UNION
    SELECT tenant_id::text FROM audit_log_archive WHERE chain_seq IS NOT NULL
  ) s
  WHERE NOT EXISTS (SELECT 1 FROM tenants tn WHERE tn.id::text = s.tenant_id);

  FOREACH t IN ARRAY lifted LOOP
    EXECUTE format('ALTER TABLE %I FORCE ROW LEVEL SECURITY', t);
  END LOOP;

  IF n_skipped > 0 THEN
    RAISE WARNING
      '295_audit_chain_cutover_seed: % chained tenant id(s) match no tenants row and got no cut-over (developer-default residue; their legacy rows fail keyed verification)',
      n_skipped;
  END IF;
  RAISE NOTICE '295_audit_chain_cutover_seed: cut-over seeded for % tenant(s) from heads, % back-filled from chained rows',
    n_seeded, n_backfilled;
END
$cutover_seed$;

INSERT INTO schema_migrations (filename)
VALUES ('295_audit_chain_cutover_seed.sql')
ON CONFLICT (filename) DO NOTHING;
