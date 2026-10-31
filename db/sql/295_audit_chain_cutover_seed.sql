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
-- rows written since the first apply). Runs as the migrator (table owner), so
-- RLS on audit_chain_cutover / audit_chain_heads does not filter these rows.

-- 1) Seed from the authoritative per-tenant head.
INSERT INTO audit_chain_cutover (tenant_id, cutover_seq)
SELECT h.tenant_id, h.head_seq
FROM audit_chain_heads h
ON CONFLICT (tenant_id) DO NOTHING;

-- 2) Back-fill any tenant that has chained rows but no head row, from the
--    highest chain_seq observed across live and archive. DISTINCT so each
--    tenant yields one candidate; ON CONFLICT protects tenants seeded in (1).
INSERT INTO audit_chain_cutover (tenant_id, cutover_seq)
SELECT s.tenant_id, max(s.chain_seq) AS cutover_seq
FROM (
  SELECT tenant_id, chain_seq FROM audit_log_entries WHERE chain_seq IS NOT NULL
  UNION ALL
  SELECT tenant_id, chain_seq FROM audit_log_archive WHERE chain_seq IS NOT NULL
) s
GROUP BY s.tenant_id
ON CONFLICT (tenant_id) DO NOTHING;

INSERT INTO schema_migrations (filename)
VALUES ('295_audit_chain_cutover_seed.sql')
ON CONFLICT (filename) DO NOTHING;
