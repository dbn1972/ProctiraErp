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
--   * audit_archive_expired_entries() (119) is redefined to copy key_id into
--     audit_log_archive (UAT-DB-004).
--
-- Additive / idempotent. Does not edit the 022/028/053/069/119 files (checksum
-- ledger); 119's function is replaced by CREATE OR REPLACE below.
-- Needs DB review (chain cut-over + verifier contract change).

ALTER TABLE audit_log_entries
  ADD COLUMN IF NOT EXISTS key_id TEXT;

ALTER TABLE audit_log_archive
  ADD COLUMN IF NOT EXISTS key_id TEXT;

COMMENT ON COLUMN audit_log_entries.key_id IS
  'PRC-M200: HMAC key id that signed entry_hash. NULL = legacy unkeyed sha256 row (at/below the tenant cut-over).';

-- UAT-DB-004: archival must carry key_id. 119's audit_archive_expired_entries()
-- copies an explicit column list that predates key_id, so an archived keyed row
-- landed in audit_log_archive with key_id NULL. Above the cut-over the verifier
-- then reads it as a forged unkeyed row, verifyChain fails for good, and the
-- signing key id is lost. The redefinition below is 119's function verbatim
-- (signature, SECURITY DEFINER, search_path, tenant guard, retention lookup,
-- DELETE ... RETURNING / INSERT CTE, GUC handling, grants) with key_id added to
-- the INSERT target list and the SELECT list; every other audit_log_entries
-- column was already copied. It lives here, right after the key_id columns are
-- added, rather than in a new file: 119 is on main and in the checksum ledger,
-- 291-296 is B07's own range (297-302 is reserved by another track), and this
-- file is unmerged, so B07 ships the column and its archival copy together with
-- no window in which a keyed row can be archived without its key id.
CREATE OR REPLACE FUNCTION audit_archive_expired_entries(p_tenant_id TEXT)
RETURNS TABLE (archived_count INTEGER, cutoff_at TIMESTAMPTZ, destination TEXT)
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
DECLARE
  v_months      INTEGER;
  v_enabled     BOOLEAN;
  v_destination TEXT;
  v_cutoff      TIMESTAMPTZ;
  v_count       INTEGER;
  -- tenant_id is uuid after 100_tenant_id_uuid_fks (APPLY_STRICT_FKS=1) and text before it;
  -- compare in the column's own type so the (tenant_id, …) indexes are used.
  v_cast        TEXT;
BEGIN
  IF p_tenant_id IS NULL OR p_tenant_id = ''
     OR p_tenant_id IS DISTINCT FROM NULLIF(current_setting('app.tenant_id', true), '') THEN
    RAISE EXCEPTION 'audit archival tenant must match the bound app.tenant_id'
      USING ERRCODE = '42501';
  END IF;

  SELECT CASE WHEN data_type = 'uuid' THEN '::uuid' ELSE '' END
    INTO v_cast
    FROM information_schema.columns
   WHERE table_schema = 'public' AND table_name = 'audit_log_entries' AND column_name = 'tenant_id';

  EXECUTE format(
    'SELECT retention_months, archival_enabled, archival_destination
       FROM audit_retention_configs WHERE tenant_id = $1%s',
    (SELECT CASE WHEN data_type = 'uuid' THEN '::uuid' ELSE '' END
       FROM information_schema.columns
      WHERE table_schema = 'public' AND table_name = 'audit_retention_configs'
        AND column_name = 'tenant_id')
  ) INTO v_months, v_enabled, v_destination USING p_tenant_id;

  IF NOT COALESCE(v_enabled, FALSE) OR v_months IS NULL OR v_months < 1 THEN
    RETURN QUERY SELECT 0, NULL::TIMESTAMPTZ, v_destination;
    RETURN;
  END IF;

  v_cutoff := now() - make_interval(months => v_months);

  -- The append-only trigger (022) only lets the archival routine delete.
  PERFORM set_config('app.audit_archival', '1', true);

  EXECUTE format(
    'WITH moved AS (
       DELETE FROM audit_log_entries
        WHERE tenant_id = $1%s AND occurred_at < $2
       RETURNING *
     ), archived AS (
       INSERT INTO audit_log_archive (
         id, tenant_id, entity_type, entity_id, operation, user_id, user_name,
         ip_address, occurred_at, before_values, after_values, metadata, created_at,
         chain_seq, prev_hash, entry_hash, key_id, archived_at, destination
       )
       SELECT id, tenant_id, entity_type, entity_id, operation, user_id, user_name,
              ip_address, occurred_at, before_values, after_values, metadata, created_at,
              chain_seq, prev_hash, entry_hash, key_id, now(), $3
         FROM moved
       RETURNING 1
     )
     SELECT count(*)::INTEGER FROM archived',
    COALESCE(v_cast, '')
  ) INTO v_count USING p_tenant_id, v_cutoff, v_destination;

  PERFORM set_config('app.audit_archival', '', true);

  UPDATE audit_retention_configs
     SET last_archival_at = now(), updated_at = now()
   WHERE tenant_id::text = p_tenant_id;

  RETURN QUERY SELECT v_count, v_cutoff, v_destination;
END;
$$;

REVOKE ALL ON FUNCTION audit_archive_expired_entries(TEXT) FROM PUBLIC;

DO $$
BEGIN
  IF EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'proctira_app') THEN
    GRANT EXECUTE ON FUNCTION audit_archive_expired_entries(TEXT) TO proctira_app;
    -- Re-assert the 053 posture: the runtime role never deletes audit rows directly.
    REVOKE UPDATE, DELETE, TRUNCATE, TRIGGER ON audit_log_entries FROM proctira_app;
  END IF;
END $$;

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
