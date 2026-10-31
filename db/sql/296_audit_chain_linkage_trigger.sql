-- PRC-M200 — keyed HMAC audit chain: linkage-only validating trigger.
--
-- The database holds no HMAC key (the key lives in KMS and the HMAC is computed
-- in the application, audit-hash.ts), so the DB cannot verify entry_hash. What
-- it CAN enforce, cheaply and in-row, is *linkage*: a chained insert must point
-- at the current tenant head. This closes the design's "a non-linking chained
-- insert is rejected" case at the storage layer, independently of the keyed
-- application verifier, so a direct INSERT that fabricates a chained row with a
-- wrong prev_hash or a non-contiguous chain_seq fails immediately.
--
-- Rules enforced on INSERT of a chained row (chain_seq IS NOT NULL) into
-- audit_log_entries:
--   * chain_seq must equal the tenant's current head_seq + 1 (contiguous, no
--     gaps, no rewind);
--   * prev_hash must equal the tenant's current head_hash (links to the head);
--   * the genesis row (head_seq = 0 / no head) must have chain_seq = 1 and
--     prev_hash IS NULL.
-- The trigger does NOT advance audit_chain_heads — the SECURITY DEFINER
-- functions (292/293) own that under their row lock. It only validates the row
-- being written against the already-locked head, so the definer path (which
-- holds the head FOR UPDATE before inserting) passes while a direct forged
-- insert is rejected.
--
-- Unkeyed legacy rows are untouched: the trigger fires only for chained inserts,
-- and legacy data is already present (not re-inserted) at apply time. Archive
-- moves (119) insert into audit_log_archive, not audit_log_entries, so they are
-- out of scope here.
--
-- Additive / idempotent (CREATE OR REPLACE + DROP TRIGGER IF EXISTS).

CREATE OR REPLACE FUNCTION audit_chain_validate_linkage()
RETURNS trigger
LANGUAGE plpgsql
AS $$
DECLARE
  v_head_seq  bigint;
  v_head_hash text;
  v_found     boolean := false;
BEGIN
  -- Only chained rows are linkage-checked; legacy unchained rows pass through.
  IF NEW.chain_seq IS NULL THEN
    RETURN NEW;
  END IF;

  SELECT h.head_seq, h.head_hash
    INTO v_head_seq, v_head_hash
  FROM audit_chain_heads h
  WHERE h.tenant_id = NEW.tenant_id;

  v_found := FOUND;

  IF NOT v_found OR COALESCE(v_head_seq, 0) = 0 THEN
    -- Genesis: the first chained row for this tenant.
    IF NEW.chain_seq <> 1 THEN
      RAISE EXCEPTION
        'audit_chain linkage: genesis row for tenant % must have chain_seq=1, got %',
        NEW.tenant_id, NEW.chain_seq
        USING ERRCODE = '23514';
    END IF;
    IF NEW.prev_hash IS NOT NULL THEN
      RAISE EXCEPTION
        'audit_chain linkage: genesis row for tenant % must have NULL prev_hash',
        NEW.tenant_id
        USING ERRCODE = '23514';
    END IF;
    RETURN NEW;
  END IF;

  -- Subsequent row: must extend the head by exactly one and link to it.
  IF NEW.chain_seq <> v_head_seq + 1 THEN
    RAISE EXCEPTION
      'audit_chain linkage: tenant % expected chain_seq %, got % (non-contiguous)',
      NEW.tenant_id, v_head_seq + 1, NEW.chain_seq
      USING ERRCODE = '23514';
  END IF;
  IF NEW.prev_hash IS DISTINCT FROM v_head_hash THEN
    RAISE EXCEPTION
      'audit_chain linkage: tenant % prev_hash does not match current head hash',
      NEW.tenant_id
      USING ERRCODE = '23514';
  END IF;

  RETURN NEW;
END;
$$;

COMMENT ON FUNCTION audit_chain_validate_linkage() IS
  'PRC-M200: reject chained audit_log_entries inserts that do not link to the current tenant head (contiguous chain_seq + matching prev_hash). Linkage only; HMAC is verified in the application.';

DROP TRIGGER IF EXISTS audit_chain_validate_linkage_trg ON audit_log_entries;
CREATE TRIGGER audit_chain_validate_linkage_trg
  BEFORE INSERT ON audit_log_entries
  FOR EACH ROW
  EXECUTE FUNCTION audit_chain_validate_linkage();

INSERT INTO schema_migrations (filename)
VALUES ('296_audit_chain_linkage_trigger.sql')
ON CONFLICT (filename) DO NOTHING;
