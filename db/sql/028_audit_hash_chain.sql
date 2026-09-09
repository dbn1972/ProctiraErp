-- Wave 9 (G-913) — tamper-evident audit hash chain + retention runtime.
--
-- Extends 022_control_plane_schema.sql:
--   * audit_log_entries / audit_log_archive gain chain_seq, prev_hash, entry_hash
--     (NULL on rows written before this migration — "legacy" rows the verifier
--     reports but does not fail).
--   * audit_chain_heads holds the per-tenant head (seq + hash). The repository
--     locks the tenant's head row FOR UPDATE inside the insert transaction so
--     concurrent writers serialise and the chain has no gaps or forks.
--
-- Verification (`GET /audit-logs/chain/verify`) walks active + archived rows
-- ordered by chain_seq and recomputes sha256(canonical payload || prev_hash);
-- any edit, deletion or re-order — even with the append-only trigger disabled —
-- surfaces as the first broken position.

ALTER TABLE audit_log_entries
  ADD COLUMN IF NOT EXISTS chain_seq  BIGINT,
  ADD COLUMN IF NOT EXISTS prev_hash  TEXT,
  ADD COLUMN IF NOT EXISTS entry_hash TEXT;

ALTER TABLE audit_log_archive
  ADD COLUMN IF NOT EXISTS chain_seq  BIGINT,
  ADD COLUMN IF NOT EXISTS prev_hash  TEXT,
  ADD COLUMN IF NOT EXISTS entry_hash TEXT;

CREATE UNIQUE INDEX IF NOT EXISTS audit_log_entries_tenant_chain_seq_idx
  ON audit_log_entries (tenant_id, chain_seq)
  WHERE chain_seq IS NOT NULL;
CREATE INDEX IF NOT EXISTS audit_log_archive_tenant_chain_seq_idx
  ON audit_log_archive (tenant_id, chain_seq);

CREATE TABLE IF NOT EXISTS audit_chain_heads (
  tenant_id   TEXT PRIMARY KEY,
  head_seq    BIGINT NOT NULL DEFAULT 0,
  head_hash   TEXT,
  updated_at  TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

ALTER TABLE audit_chain_heads ENABLE ROW LEVEL SECURITY;
ALTER TABLE audit_chain_heads FORCE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS tenant_isolation ON audit_chain_heads;
CREATE POLICY tenant_isolation ON audit_chain_heads FOR ALL
  USING (tenant_id = NULLIF(current_setting('app.tenant_id', true), '')
         OR current_setting('app.platform_admin', true) = '1')
  WITH CHECK (tenant_id = NULLIF(current_setting('app.tenant_id', true), '')
         OR current_setting('app.platform_admin', true) = '1');

-- Retention configs get the archival-enabled lookup the runtime scheduler uses.
CREATE INDEX IF NOT EXISTS audit_retention_configs_archival_idx
  ON audit_retention_configs (archival_enabled)
  WHERE archival_enabled;

INSERT INTO schema_migrations (filename)
VALUES ('028_audit_hash_chain.sql')
ON CONFLICT (filename) DO NOTHING;
