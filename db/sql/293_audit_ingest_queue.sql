-- PRC-M200 / DR4-4 — audit ingest queue + seal into the keyed chain.
--
-- System-originated audit events (demo seed L461, background jobs, async
-- side-effects) cannot always run inside the originating tenant transaction.
-- They are enqueued into audit_ingest_queue and later *sealed* into the keyed
-- chain by the drain (apps/api-gateway/src/audit-ingest-drain.ts) at boot and
-- on an interval. The queue is FORCE RLS tenant-isolated with NO platform_admin
-- branch: a row is visible only to its own tenant, exactly like the sealed
-- entry. Sealing is a SECURITY DEFINER function so the runtime role never gets
-- UPDATE on the queue directly (294 classes it append_only).
--
-- Additive / idempotent.

-- ---------------------------------------------------------------------------
-- DR4-4 columns. id is a surrogate identity so the drain can order enqueues
-- deterministically; tenant_id is UUID with a validated FK to tenants(id)
-- (W1-DATA-06, B07 Q2 option B; the table is created empty, so the inline FK is
-- valid at creation; NO ACTION on delete like the other audit_* tenant FKs).
-- actor_kind records system vs human origin; user_id is nullable
-- for 'system:<job>' rows. sealed_at + chain_seq are set only by the seal
-- function once the row lands in the keyed chain.
-- ---------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS audit_ingest_queue (
  id           BIGINT GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  tenant_id    UUID NOT NULL
    CONSTRAINT audit_ingest_queue_tenant_fk REFERENCES tenants (id),
  entity_type  TEXT NOT NULL,
  entity_id    TEXT NOT NULL,
  operation    TEXT NOT NULL,
  user_id      TEXT,
  actor_kind   TEXT NOT NULL DEFAULT 'system:unknown',
  user_name    TEXT NOT NULL DEFAULT 'system',
  ip_address   TEXT NOT NULL DEFAULT '0.0.0.0',
  occurred_at  TIMESTAMPTZ NOT NULL DEFAULT now(),
  before_values JSONB,
  after_values  JSONB,
  metadata     JSONB,
  enqueued_at  TIMESTAMPTZ NOT NULL DEFAULT now(),
  sealed_at    TIMESTAMPTZ,
  chain_seq    BIGINT,
  -- Deterministic dedup key for idempotent enqueue (DR4-3 seed re-runs).
  dedupe_key   TEXT
);

COMMENT ON TABLE audit_ingest_queue IS
  'PRC-M200/DR4-4: pending system-origin audit events; sealed into the keyed chain by the drain. FORCE RLS, append_only for runtime, sealed via definer only.';
COMMENT ON COLUMN audit_ingest_queue.actor_kind IS
  'PRC-M200: origin class, e.g. system:<job>, human. user_id NULL allowed for system rows.';
COMMENT ON COLUMN audit_ingest_queue.sealed_at IS
  'PRC-M200: set by audit_ingest_seal() once the row is appended to the keyed chain; NULL = pending.';
COMMENT ON COLUMN audit_ingest_queue.dedupe_key IS
  'PRC-M200/DR4-3: optional idempotency key; a UNIQUE partial index drops re-enqueues of the same logical event while pending.';

-- Idempotent enqueue support: one pending row per dedupe_key.
CREATE UNIQUE INDEX IF NOT EXISTS audit_ingest_queue_dedupe_pending_uidx
  ON audit_ingest_queue (tenant_id, dedupe_key)
  WHERE dedupe_key IS NOT NULL AND sealed_at IS NULL;

-- Drain scans pending rows oldest-first per tenant.
CREATE INDEX IF NOT EXISTS audit_ingest_queue_pending_idx
  ON audit_ingest_queue (tenant_id, id)
  WHERE sealed_at IS NULL;

ALTER TABLE audit_ingest_queue ENABLE ROW LEVEL SECURITY;
ALTER TABLE audit_ingest_queue FORCE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS tenant_isolation ON audit_ingest_queue;
-- No platform_admin branch (DR4-4): a queued row is tenant data, visible only
-- to its own tenant. The drain binds each tenant's GUC before sealing. The uuid
-- column compares as text against the GUC (099/100 convention), so a missing
-- or malformed app.tenant_id denies instead of raising on a ::uuid cast.
CREATE POLICY tenant_isolation ON audit_ingest_queue FOR ALL
  USING (tenant_id::text = app_tenant_id())
  WITH CHECK (tenant_id::text = app_tenant_id());

-- ---------------------------------------------------------------------------
-- Seal one pending queue row into the keyed chain. SECURITY DEFINER, bound to
-- the caller tenant (DR4-7 compare), raises 42501 on cross-tenant. Guards
-- against double-seal: a row whose sealed_at is already set raises rather than
-- appending a duplicate chain entry. Returns the assigned chain_seq.
-- The entry_hash/key_id are computed by the drain (HMAC under the KMS key) and
-- passed in, mirroring audit_chain_append.
-- ---------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION audit_ingest_seal(
  p_tenant     text,
  p_queue_id   bigint,
  p_entry_id   text,
  p_entry_hash text,
  p_key_id     text
)
RETURNS TABLE (chain_seq bigint)
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
DECLARE
  v_bound text := audit_chain_effective_tenant();
  -- audit_chain_heads.tenant_id and audit_log_entries.tenant_id are UUID after
  -- db/sql/100, and the queue table (this migration) is UUID too. Bind the
  -- uuid form once, after the tenant-match guard.
  v_bound_uuid uuid;
  v_row   audit_ingest_queue%ROWTYPE;
  v_seq   bigint;
  v_prev  text;
BEGIN
  IF v_bound IS NULL THEN
    RAISE EXCEPTION 'audit_ingest_seal: no tenant bound (app.tenant_id unset)'
      USING ERRCODE = '42501';
  END IF;
  IF lower(btrim(p_tenant)) IS DISTINCT FROM lower(v_bound) THEN
    RAISE EXCEPTION 'audit_ingest_seal: tenant % does not match bound tenant', p_tenant
      USING ERRCODE = '42501';
  END IF;
  IF p_entry_hash IS NULL OR p_key_id IS NULL THEN
    RAISE EXCEPTION 'audit_ingest_seal: keyed rows require entry_hash and key_id'
      USING ERRCODE = '23514';
  END IF;

  v_bound_uuid := v_bound::uuid;

  -- Lock the queue row; it must belong to the bound tenant.
  SELECT * INTO v_row
  FROM audit_ingest_queue
  WHERE id = p_queue_id AND tenant_id = v_bound_uuid
  FOR UPDATE;

  IF NOT FOUND THEN
    RAISE EXCEPTION 'audit_ingest_seal: queue row % not found for bound tenant', p_queue_id
      USING ERRCODE = '42501';
  END IF;
  -- Double-seal guard.
  IF v_row.sealed_at IS NOT NULL THEN
    RAISE EXCEPTION 'audit_ingest_seal: queue row % already sealed at %', p_queue_id, v_row.sealed_at
      USING ERRCODE = '23514';
  END IF;

  -- Append to the keyed chain under the same head lock discipline as the
  -- synchronous path.
  INSERT INTO audit_chain_heads (tenant_id)
  VALUES (v_bound_uuid)
  ON CONFLICT (tenant_id) DO NOTHING;

  SELECT h.head_seq, h.head_hash INTO v_seq, v_prev
  FROM audit_chain_heads h
  WHERE h.tenant_id = v_bound_uuid
  FOR UPDATE;

  v_seq := COALESCE(v_seq, 0) + 1;

  INSERT INTO audit_log_entries (
    id, tenant_id, entity_type, entity_id, operation, user_id, user_name,
    ip_address, occurred_at, before_values, after_values, metadata,
    chain_seq, prev_hash, entry_hash, key_id
  ) VALUES (
    -- audit_log_entries.id and tenant_id are UUID; the drain passes text.
    -- audit_log_entries.user_id is NOT NULL, but queue rows may carry a NULL
    -- user_id for system-origin events (DR4-4, actor_kind 'system:<job>'). Keep
    -- the actor by falling back to actor_kind so the sealed entry records who
    -- acted ('system:<job>') instead of violating the NOT NULL column.
    p_entry_id::uuid, v_bound_uuid, v_row.entity_type, v_row.entity_id, v_row.operation,
    COALESCE(v_row.user_id, v_row.actor_kind), v_row.user_name, v_row.ip_address, v_row.occurred_at,
    v_row.before_values, v_row.after_values, v_row.metadata,
    v_seq, v_prev, p_entry_hash, p_key_id
  );

  UPDATE audit_chain_heads
  SET head_seq = v_seq, head_hash = p_entry_hash, updated_at = now()
  WHERE tenant_id = v_bound_uuid;

  UPDATE audit_ingest_queue
  SET sealed_at = now(), chain_seq = v_seq
  WHERE id = p_queue_id;

  RETURN QUERY SELECT v_seq;
END;
$$;

COMMENT ON FUNCTION audit_ingest_seal(text, bigint, text, text, text) IS
  'PRC-M200/DR4-4: seal one pending queue row into the keyed chain (SECURITY DEFINER, tenant-bound, 42501 cross-tenant, double-seal guarded).';

-- ---------------------------------------------------------------------------
-- audit_ingest_pending_tenants(): list tenants with unsealed rows so the drain
-- can iterate them and bind each tenant GUC in turn. SECURITY DEFINER with a
-- platform guard: callable only when app.platform_admin='1' (the drain binds
-- the platform context), never by a tenant session.
-- ---------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION audit_ingest_pending_tenants()
RETURNS TABLE (tenant_id text, pending_count bigint)
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
BEGIN
  IF current_setting('app.platform_admin', true) IS DISTINCT FROM '1' THEN
    RAISE EXCEPTION 'audit_ingest_pending_tenants: platform context required'
      USING ERRCODE = '42501';
  END IF;
  -- tenant_id is returned as text (the drain binds it as the app.tenant_id GUC).
  RETURN QUERY
    SELECT q.tenant_id::text, count(*)::bigint
    FROM audit_ingest_queue q
    WHERE q.sealed_at IS NULL
    GROUP BY q.tenant_id
    ORDER BY q.tenant_id;
END;
$$;

COMMENT ON FUNCTION audit_ingest_pending_tenants() IS
  'PRC-M200/DR4-4: tenants with unsealed queue rows (SECURITY DEFINER, platform-context only).';

DO $$
BEGIN
  IF EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'proctira_app') THEN
    EXECUTE 'GRANT EXECUTE ON FUNCTION audit_ingest_seal(text, bigint, text, text, text) TO proctira_app';
    EXECUTE 'GRANT EXECUTE ON FUNCTION audit_ingest_pending_tenants() TO proctira_app';
  END IF;
END $$;

REVOKE EXECUTE ON FUNCTION audit_ingest_seal(text, bigint, text, text, text) FROM PUBLIC;
REVOKE EXECUTE ON FUNCTION audit_ingest_pending_tenants() FROM PUBLIC;

INSERT INTO schema_migrations (filename)
VALUES ('293_audit_ingest_queue.sql')
ON CONFLICT (filename) DO NOTHING;
