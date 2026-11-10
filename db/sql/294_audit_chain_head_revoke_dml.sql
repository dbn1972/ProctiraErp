-- PRC-M200 — keyed HMAC audit chain: revoke direct head DML from the runtime role.
--
-- 028_audit_hash_chain.sql granted the runtime role (proctira_app) INSERT/UPDATE
-- on audit_chain_heads so the application could advance the chain head directly
-- (txn-mutation-audit.ts did INSERT ... ON CONFLICT + SELECT ... FOR UPDATE +
-- UPDATE). That direct-DML path lets a compromised app role rewind head_seq /
-- head_hash and fork the chain.
--
-- 292/293 introduced the SECURITY DEFINER write path
-- (audit_chain_lock_head / audit_chain_append / audit_ingest_seal), owned by the
-- migrator and callable only by proctira_app, which binds every append to the
-- caller tenant (DR4-7) and advances the head under a row lock. This migration
-- makes those functions the ONLY head-mutation path by revoking direct UPDATE /
-- DELETE (and the no-longer-needed direct INSERT) on audit_chain_heads from the
-- runtime role. The runtime switch lands in the SAME commit
-- (packages/backend/audit/src/txn-mutation-audit.ts) so the synchronous audit
-- path keeps working — it now calls audit_chain_append() instead of the direct
-- INSERT/UPDATE.
--
-- Privilege classes after this migration (db/runtime-table-privileges.json):
--   audit_chain_heads    dml  -> trigger_owned   (SELECT only; writes via definer)
--   audit_chain_cutover       -> trigger_owned   (SELECT only; written by migration)
--   audit_ingest_queue        -> append_only     (SELECT+INSERT; sealed via definer)
--
-- audit_chain_heads keeps SELECT so the chain verifier and the append functions
-- (which run as definer but read the current head) stay available. The definer
-- functions are owned by the migrator, so the owner's own privileges let them
-- INSERT/UPDATE the head even though the runtime role no longer can.
--
-- Additive to the schema (no column/table change); idempotent.

DO $$
BEGIN
  IF EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'proctira_app') THEN
    -- Drop every direct write on the head table. SELECT is re-granted below so
    -- the runtime verifier and the definer read path keep working.
    EXECUTE 'REVOKE INSERT, UPDATE, DELETE, TRUNCATE ON audit_chain_heads FROM proctira_app';
    EXECUTE 'GRANT SELECT ON audit_chain_heads TO proctira_app';

    -- The cut-over boundary is written by migration only; runtime reads it.
    EXECUTE 'REVOKE INSERT, UPDATE, DELETE, TRUNCATE ON audit_chain_cutover FROM proctira_app';
    EXECUTE 'GRANT SELECT ON audit_chain_cutover TO proctira_app';

    -- The ingest queue is append-only for the runtime role: it may enqueue
    -- (INSERT) and read (SELECT) but never UPDATE/DELETE — sealing is done by
    -- the SECURITY DEFINER audit_ingest_seal().
    EXECUTE 'REVOKE UPDATE, DELETE, TRUNCATE ON audit_ingest_queue FROM proctira_app';
    EXECUTE 'GRANT SELECT, INSERT ON audit_ingest_queue TO proctira_app';
  END IF;
END $$;

INSERT INTO schema_migrations (filename)
VALUES ('294_audit_chain_head_revoke_dml.sql')
ON CONFLICT (filename) DO NOTHING;
