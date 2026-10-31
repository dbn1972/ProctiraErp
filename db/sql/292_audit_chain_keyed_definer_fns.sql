-- PRC-M200 — keyed HMAC audit chain: SECURITY DEFINER head lock + append.
--
-- The base chain (028) let the runtime role UPDATE audit_chain_heads directly
-- (privilege class "dml"), so a compromised app role could rewind head_seq /
-- head_hash and fork the chain. This batch moves head mutation behind two
-- SECURITY DEFINER functions owned by the migrator (table owner) and callable
-- only by proctira_app:
--
--   * audit_chain_lock_head(tenant) -> locks the tenant's head row FOR UPDATE
--     and returns (head_seq, head_hash). Serialises concurrent writers.
--   * audit_chain_append(tenant, entry_id, entity_type, entity_id, operation,
--       user_id, user_name, ip_address, occurred_at, before, after, metadata,
--       entry_hash, key_id) -> inserts one audit_log_entries row at head_seq+1
--     with prev_hash = current head_hash, advances the head, returns chain_seq.
--
-- Both functions bind to the caller's tenant: the tenant argument must equal
-- the GUC app.tenant_id (compared case-insensitively and trimmed per DR4-7).
-- A mismatch raises SQLSTATE 42501 (insufficient_privilege) so a cross-tenant
-- call can never advance another tenant's chain. The HMAC itself is computed in
-- the application (audit-hash.ts) under the KMS key; the DB stores entry_hash +
-- key_id and enforces ordering / tenant binding only.
--
-- Additive / idempotent (CREATE OR REPLACE). 294 revokes the direct-DML grant
-- on audit_chain_heads and reclassifies it to trigger_owned so these functions
-- become the only write path.

-- ---------------------------------------------------------------------------
-- DR4-7 tenant-binding guard: current GUC tenant, trimmed + lower-cased.
-- Returns NULL when unbound so callers can distinguish "no tenant" from a
-- genuine mismatch.
-- ---------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION audit_chain_effective_tenant()
RETURNS text
LANGUAGE sql
STABLE
AS $$
  SELECT NULLIF(btrim(app_tenant_id()), '');
$$;

COMMENT ON FUNCTION audit_chain_effective_tenant() IS
  'PRC-M200: bound tenant for keyed-chain definer functions (trimmed app_tenant_id()).';

-- ---------------------------------------------------------------------------
-- Lock the caller tenant's chain head FOR UPDATE and return it. Creates the
-- head row (seq 0, hash NULL) on first use. SECURITY DEFINER so the runtime
-- role cannot UPDATE the table directly (294) yet can still serialise writers.
-- ---------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION audit_chain_lock_head(p_tenant text)
RETURNS TABLE (head_seq bigint, head_hash text)
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
DECLARE
  v_bound text := audit_chain_effective_tenant();
BEGIN
  IF v_bound IS NULL THEN
    RAISE EXCEPTION 'audit_chain_lock_head: no tenant bound (app.tenant_id unset)'
      USING ERRCODE = '42501';
  END IF;
  -- DR4-7: case-insensitive, trimmed compare so a mixed-case uuid argument
  -- cannot bypass the binding.
  IF lower(btrim(p_tenant)) IS DISTINCT FROM lower(v_bound) THEN
    RAISE EXCEPTION 'audit_chain_lock_head: tenant % does not match bound tenant', p_tenant
      USING ERRCODE = '42501';
  END IF;

  INSERT INTO audit_chain_heads (tenant_id)
  VALUES (v_bound)
  ON CONFLICT (tenant_id) DO NOTHING;

  RETURN QUERY
    SELECT h.head_seq, h.head_hash
    FROM audit_chain_heads h
    WHERE h.tenant_id = v_bound
    FOR UPDATE;
END;
$$;

COMMENT ON FUNCTION audit_chain_lock_head(text) IS
  'PRC-M200: lock the bound tenant chain head FOR UPDATE (SECURITY DEFINER); 42501 on cross-tenant/unbound.';

-- ---------------------------------------------------------------------------
-- Append one keyed audit row at head_seq+1 and advance the head atomically.
-- Caller supplies the app-computed entry_hash (HMAC) + key_id. The function
-- re-locks the head itself so it is safe whether or not the caller already
-- called audit_chain_lock_head (same transaction, same FOR UPDATE row lock).
-- ---------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION audit_chain_append(
  p_tenant       text,
  p_entry_id     text,
  p_entity_type  text,
  p_entity_id    text,
  p_operation    text,
  p_user_id      text,
  p_user_name    text,
  p_ip_address   text,
  p_occurred_at  timestamptz,
  p_before       jsonb,
  p_after        jsonb,
  p_metadata     jsonb,
  p_entry_hash   text,
  p_key_id       text
)
RETURNS TABLE (chain_seq bigint, prev_hash text)
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
DECLARE
  v_bound    text := audit_chain_effective_tenant();
  v_prev     text;
  v_seq      bigint;
BEGIN
  IF v_bound IS NULL THEN
    RAISE EXCEPTION 'audit_chain_append: no tenant bound (app.tenant_id unset)'
      USING ERRCODE = '42501';
  END IF;
  IF lower(btrim(p_tenant)) IS DISTINCT FROM lower(v_bound) THEN
    RAISE EXCEPTION 'audit_chain_append: tenant % does not match bound tenant', p_tenant
      USING ERRCODE = '42501';
  END IF;
  IF p_entry_hash IS NULL OR p_key_id IS NULL THEN
    RAISE EXCEPTION 'audit_chain_append: keyed rows require entry_hash and key_id'
      USING ERRCODE = '23514';
  END IF;

  INSERT INTO audit_chain_heads (tenant_id)
  VALUES (v_bound)
  ON CONFLICT (tenant_id) DO NOTHING;

  SELECT h.head_seq, h.head_hash INTO v_seq, v_prev
  FROM audit_chain_heads h
  WHERE h.tenant_id = v_bound
  FOR UPDATE;

  v_seq := COALESCE(v_seq, 0) + 1;

  INSERT INTO audit_log_entries (
    id, tenant_id, entity_type, entity_id, operation, user_id, user_name,
    ip_address, occurred_at, before_values, after_values, metadata,
    chain_seq, prev_hash, entry_hash, key_id
  ) VALUES (
    p_entry_id, v_bound, p_entity_type, p_entity_id, p_operation, p_user_id, p_user_name,
    p_ip_address, p_occurred_at, p_before, p_after, p_metadata,
    v_seq, v_prev, p_entry_hash, p_key_id
  );

  UPDATE audit_chain_heads
  SET head_seq = v_seq, head_hash = p_entry_hash, updated_at = now()
  WHERE tenant_id = v_bound;

  RETURN QUERY SELECT v_seq, v_prev;
END;
$$;

COMMENT ON FUNCTION audit_chain_append(
  text, text, text, text, text, text, text, text, timestamptz, jsonb, jsonb, jsonb, text, text) IS
  'PRC-M200: append one keyed audit row and advance the head (SECURITY DEFINER, tenant-bound, 42501 cross-tenant).';

-- Runtime role calls the definer functions; no direct head DML (294 revokes it).
DO $$
BEGIN
  IF EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'proctira_app') THEN
    EXECUTE 'GRANT EXECUTE ON FUNCTION audit_chain_effective_tenant() TO proctira_app';
    EXECUTE 'GRANT EXECUTE ON FUNCTION audit_chain_lock_head(text) TO proctira_app';
    EXECUTE 'GRANT EXECUTE ON FUNCTION audit_chain_append('
      || 'text, text, text, text, text, text, text, text, timestamptz, jsonb, jsonb, jsonb, text, text'
      || ') TO proctira_app';
  END IF;
END $$;

-- Keep the definer functions from being world-callable.
REVOKE EXECUTE ON FUNCTION audit_chain_lock_head(text) FROM PUBLIC;
REVOKE EXECUTE ON FUNCTION audit_chain_append(
  text, text, text, text, text, text, text, text, timestamptz, jsonb, jsonb, jsonb, text, text) FROM PUBLIC;

INSERT INTO schema_migrations (filename)
VALUES ('292_audit_chain_keyed_definer_fns.sql')
ON CONFLICT (filename) DO NOTHING;
