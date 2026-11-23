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
-- binds no app.tenant_id, so with no scope the source SELECTs see zero rows and
-- no tenant gets a cut-over; the keyed verifier would then reject every legacy
-- row of every existing tenant.
--
-- Reads: the block binds app.platform_admin='1' transaction-locally. tenants,
-- audit_chain_heads, audit_log_entries and audit_log_archive each have a
-- "OR current_setting('app.platform_admin', true) = '1'" branch in their
-- tenant_isolation policy (strict and developer-default postures alike), so the
-- scan sees every tenant's rows with FORCE left in place on all four.
-- Write: audit_chain_cutover's policy has no platform branch by design (291),
-- so FORCE is lifted on audit_chain_cutover ONLY, for the two INSERTs, and
-- restored right after. The tenants FK check on that INSERT is a system check
-- that RLS does not filter, so tenants needs no lift.
-- The prior app.platform_admin value is restored before the block ends.
--
-- Locks: the only ACCESS EXCLUSIVE lock is the one ALTER TABLE takes on
-- audit_chain_cutover, held until commit. The runtime role only reads that
-- table (SELECT only, 294), and only chain verification reads it; audit writes
-- never touch it. A concurrent verification therefore waits at most for this
-- file's transaction. The source tables get only ACCESS SHARE from the SELECTs,
-- which blocks no runtime read or write. apply-sql's lock_timeout (5 s
-- default) bounds only how long the ALTER waits to acquire its lock; the hold
-- itself, including the full scan of audit_log_entries and audit_log_archive in
-- step 2, is bounded by statement_timeout (30 min default).
--
-- Atomicity: everything runs in one DO block inside apply-sql's per-file
-- transaction (and stays one phase under APPLY_SQL_NO_TX=1), so a failure rolls
-- the lift back with it and audit_chain_cutover can never be left unforced.
-- Never re-run this file by hand: a manual re-run gives a cut-over to tenants
-- created after the first apply (which have none and need all-keyed rows).
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
  prior_platform text := current_setting('app.platform_admin', true);
  was_forced boolean;
  n_seeded bigint;
  n_backfilled bigint;
  n_skipped bigint;
BEGIN
  -- Platform scope for the source reads (policy branch, FORCE untouched).
  PERFORM set_config('app.platform_admin', '1', true);

  -- Lift FORCE on the cut-over table only, where it is set.
  SELECT relforcerowsecurity INTO was_forced
    FROM pg_class WHERE oid = 'public.audit_chain_cutover'::regclass;
  IF was_forced THEN
    ALTER TABLE audit_chain_cutover NO FORCE ROW LEVEL SECURITY;
  END IF;

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

  IF was_forced THEN
    ALTER TABLE audit_chain_cutover FORCE ROW LEVEL SECURITY;
  END IF;

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

  -- Restore the caller's platform scope (unset reads back as '').
  PERFORM set_config('app.platform_admin', coalesce(prior_platform, ''), true);

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
