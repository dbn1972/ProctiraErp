-- PRC-L093 residual: every redrive of a failed transactional_outbox row must
-- also land in the tenant audit trail, not only in the row's own
-- redrive_history column.
--
-- 242 made redrive_history append-only (shrink or in-place edit is rejected),
-- but the history still lives on a runtime-writable operational row, and
-- nothing mirrored it into audit_log_entries.
--
-- Fix: an AFTER UPDATE OF redrive_history trigger enqueues one
-- audit_ingest_queue row per newly appended history entry. The audit ingest
-- drain (apps/api-gateway/src/audit-ingest-drain.ts, 293) seals queued rows
-- into the keyed audit chain in audit_log_entries, so a redrive is recorded
-- even when the caller runs outside a tenant transaction.
--
-- Tenant binding: OutboxStore.requeueFailed runs on a platform-scoped client
-- (app.platform_admin = '1') and may redrive rows of several tenants in one
-- UPDATE, while audit_ingest_queue is FORCE RLS with no platform branch. The
-- trigger function is SECURITY DEFINER (owner, fixed search_path) and binds
-- app.tenant_id to the updated row's own tenant_id for the INSERT only, then
-- restores the caller's value. The tenant written is never caller-supplied:
-- it is the tenant of a row the caller was already allowed to UPDATE under
-- transactional_outbox's RLS.
--
-- Idempotent: CREATE OR REPLACE + DROP TRIGGER IF EXISTS; the dedupe_key
-- (outbox id + history index) drops a duplicate while it is still pending.
CREATE OR REPLACE FUNCTION transactional_outbox_redrive_audit_mirror()
RETURNS TRIGGER
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
DECLARE
  i int;
  old_len int;
  new_len int;
  entry jsonb;
  prior_tenant text := current_setting('app.tenant_id', true);
BEGIN
  IF NEW.redrive_history IS NOT DISTINCT FROM OLD.redrive_history
     OR jsonb_typeof(NEW.redrive_history) IS DISTINCT FROM 'array' THEN
    RETURN NULL;
  END IF;
  old_len := CASE WHEN jsonb_typeof(OLD.redrive_history) = 'array'
                  THEN jsonb_array_length(OLD.redrive_history) ELSE 0 END;
  new_len := jsonb_array_length(NEW.redrive_history);
  IF new_len <= old_len THEN
    RETURN NULL;
  END IF;

  PERFORM set_config('app.tenant_id', NEW.tenant_id::text, true);
  FOR i IN old_len .. new_len - 1 LOOP
    entry := NEW.redrive_history -> i;
    INSERT INTO audit_ingest_queue (
      tenant_id, entity_type, entity_id, operation, user_id, actor_kind,
      user_name, occurred_at, before_values, after_values, metadata, dedupe_key
    ) VALUES (
      NEW.tenant_id,
      'transactional_outbox',
      NEW.id::text,
      'UPDATE',
      NULLIF(entry->>'actor', ''),
      'outbox:redrive',
      COALESCE(NULLIF(entry->>'actor', ''), 'system'),
      now(),
      jsonb_build_object('status', OLD.status, 'attempts', entry->'fromAttempts'),
      jsonb_build_object('status', NEW.status, 'attempts', NEW.attempts),
      jsonb_build_object(
        'action', 'outbox.redrive',
        'reason', entry->'reason',
        'redrivenAt', entry->'at',
        'historyIndex', i,
        'eventType', NEW.event_type,
        'aggregateType', NEW.aggregate_type,
        'aggregateId', NEW.aggregate_id,
        'source', 'database_trigger'
      ),
      'outbox-redrive:' || NEW.id::text || ':' || i
    )
    ON CONFLICT (tenant_id, dedupe_key) WHERE dedupe_key IS NOT NULL AND sealed_at IS NULL
    DO NOTHING;
  END LOOP;
  PERFORM set_config('app.tenant_id', COALESCE(prior_tenant, ''), true);
  RETURN NULL;
END;
$$;
COMMENT ON FUNCTION transactional_outbox_redrive_audit_mirror() IS
  'PRC-L093: enqueue each appended transactional_outbox.redrive_history entry into audit_ingest_queue (sealed into audit_log_entries by the drain), bound to the row''s own tenant.';
REVOKE ALL ON FUNCTION transactional_outbox_redrive_audit_mirror() FROM PUBLIC;
DROP TRIGGER IF EXISTS trg_transactional_outbox_redrive_audit_mirror ON transactional_outbox;
CREATE TRIGGER trg_transactional_outbox_redrive_audit_mirror
  AFTER UPDATE OF redrive_history ON transactional_outbox
  FOR EACH ROW EXECUTE FUNCTION transactional_outbox_redrive_audit_mirror();
