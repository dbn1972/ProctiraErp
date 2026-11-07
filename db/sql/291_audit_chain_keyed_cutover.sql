-- PRC-M200 — keyed HMAC audit chain: key_id columns + per-tenant cut-over.
--
-- Base (028_audit_hash_chain.sql) stores an app-side *unkeyed* sha256 chain
-- (chain_seq / prev_hash / entry_hash; NULL on legacy rows). A DBA who knows the
-- algorithm can forge a chained row and recompute every later hash because no
-- secret is involved. This batch moves the chain to HMAC-SHA256 under a
-- KMS-held key (AUDIT_CHAIN_HMAC_KEY) without rewriting history:
--
--   * key_id column on audit_log_entries / audit_log_archive. NULL = legacy
--     unkeyed row; a non-NULL value names the HMAC key that signed the row.
--   * audit_chain_cutover(tenant_id, cutover_seq) records each tenant's head
--     chain_seq at migration time. The verifier accepts legacy unkeyed sha256
--     rows only at or below cutover_seq; every row above it must carry a known
--     key_id and verify as HMAC. The runtime role can never move a cut-over
--     (privilege class trigger_owned, 294), so forged "legacy" rows cannot be
--     back-dated past the boundary.
--
-- Additive / idempotent. Does not touch 022/028/053/069/119 (checksum ledger).
-- Needs DB review (chain cut-over + verifier contract change).

ALTER TABLE audit_log_entries
  ADD COLUMN IF NOT EXISTS key_id TEXT;

ALTER TABLE audit_log_archive
  ADD COLUMN IF NOT EXISTS key_id TEXT;

COMMENT ON COLUMN audit_log_entries.key_id IS
  'PRC-M200: HMAC key id that signed entry_hash. NULL = legacy unkeyed sha256 row (at/below the tenant cut-over).';

-- Per-tenant cut-over: the head chain_seq when the keyed chain takes over.
-- Written only by the migration (295) and never by the runtime role, so the
-- boundary between accepted legacy rows and required keyed rows is immutable at
-- runtime. W1-DATA-06 (B07 Q2 option B): tenant_id is UUID with a validated FK
-- to tenants(id), like every other tenant-owned table. The table is created
-- empty here, so the inline FK is valid at creation. NO ACTION on delete, as
-- for the other audit_* tenant FKs: a tenant with a recorded cut-over cannot be
-- deleted out from under its tamper boundary.
CREATE TABLE IF NOT EXISTS audit_chain_cutover (
  tenant_id    UUID PRIMARY KEY,
  cutover_seq  BIGINT NOT NULL DEFAULT 0,
  recorded_at  TIMESTAMPTZ NOT NULL DEFAULT now(),
  CONSTRAINT audit_chain_cutover_tenant_fk
    FOREIGN KEY (tenant_id) REFERENCES tenants (id)
);

COMMENT ON TABLE audit_chain_cutover IS
  'PRC-M200: per-tenant head chain_seq at keyed-chain migration. Legacy unkeyed rows are accepted only at/below cutover_seq. Written by migration only (runtime SELECT only).';

ALTER TABLE audit_chain_cutover ENABLE ROW LEVEL SECURITY;
ALTER TABLE audit_chain_cutover FORCE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS tenant_isolation ON audit_chain_cutover;
-- Read-scoped to the bound tenant. No platform_admin branch: the cut-over is a
-- tamper boundary, not tenant-admin data. FORCE RLS applies this policy to the
-- table owner too (the migrator is NOBYPASSRLS), so 295 lifts FORCE on this
-- table only, around its seed insert, and restores it in the same transaction
-- (UAT-DB-003). 295 reads its sources (tenants and the audit tables) through
-- their app.platform_admin policy branch and never lifts FORCE on them. The uuid
-- column compares as text against the GUC (099/100 convention): a missing or
-- malformed app.tenant_id denies instead of raising on a ::uuid cast.
CREATE POLICY tenant_isolation ON audit_chain_cutover FOR ALL
  USING (tenant_id::text = app_tenant_id())
  WITH CHECK (tenant_id::text = app_tenant_id());

INSERT INTO schema_migrations (filename)
VALUES ('291_audit_chain_keyed_cutover.sql')
ON CONFLICT (filename) DO NOTHING;
