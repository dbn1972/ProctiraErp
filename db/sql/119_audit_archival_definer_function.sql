-- PRC-M175 — audit archival runs through a SECURITY DEFINER function.
--
-- PgAuditRepository.archiveExpiredEntries used to DELETE FROM audit_log_entries
-- directly after setting app.audit_archival = '1'. 053 REVOKEs UPDATE/DELETE on
-- audit_log_entries from proctira_app (the intended runtime role), so under the
-- production posture the scheduled archival failed with "permission denied" and
-- retention_months was never honoured. Re-granting DELETE to the app role would
-- let any code path that sets the GUC purge audit rows.
--
-- This migration keeps DELETE revoked from proctira_app and adds one narrow,
-- owner-executed routine:
--   * caller tenant must equal the bound app.tenant_id (no cross-tenant purge)
--   * cutoff and destination come from audit_retention_configs, never the caller
--   * archival must be enabled for the tenant
--   * rows are copied to audit_log_archive (chain columns preserved) and deleted
--     in one statement; app.audit_archival is set only inside the function
--   * last_archival_at is stamped in the same transaction
--
-- Additive / idempotent. Do not edit 022/053/069 (checksum ledger).
-- Needs DB review (privileged function + grant).

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
BEGIN
  IF p_tenant_id IS NULL OR p_tenant_id = ''
     OR p_tenant_id IS DISTINCT FROM NULLIF(current_setting('app.tenant_id', true), '') THEN
    RAISE EXCEPTION 'audit archival tenant must match the bound app.tenant_id'
      USING ERRCODE = '42501';
  END IF;

  SELECT c.retention_months, c.archival_enabled, c.archival_destination
    INTO v_months, v_enabled, v_destination
    FROM audit_retention_configs c
   WHERE c.tenant_id = p_tenant_id;

  IF NOT FOUND OR NOT v_enabled OR v_months IS NULL OR v_months < 1 THEN
    RETURN QUERY SELECT 0, NULL::TIMESTAMPTZ, v_destination;
    RETURN;
  END IF;

  v_cutoff := now() - make_interval(months => v_months);

  -- The append-only trigger (022) only lets the archival routine delete.
  PERFORM set_config('app.audit_archival', '1', true);

  WITH moved AS (
    DELETE FROM audit_log_entries e
     WHERE e.tenant_id = p_tenant_id
       AND e.occurred_at < v_cutoff
    RETURNING e.*
  ), archived AS (
    INSERT INTO audit_log_archive (
      id, tenant_id, entity_type, entity_id, operation, user_id, user_name,
      ip_address, occurred_at, before_values, after_values, metadata, created_at,
      chain_seq, prev_hash, entry_hash, archived_at, destination
    )
    SELECT id, tenant_id, entity_type, entity_id, operation, user_id, user_name,
           ip_address, occurred_at, before_values, after_values, metadata, created_at,
           chain_seq, prev_hash, entry_hash, now(), v_destination
      FROM moved
    RETURNING 1
  )
  SELECT count(*)::INTEGER INTO v_count FROM archived;

  PERFORM set_config('app.audit_archival', '', true);

  UPDATE audit_retention_configs
     SET last_archival_at = now(), updated_at = now()
   WHERE tenant_id = p_tenant_id;

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

INSERT INTO schema_migrations (filename)
VALUES ('119_audit_archival_definer_function.sql')
ON CONFLICT (filename) DO NOTHING;
