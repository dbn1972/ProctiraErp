-- PRC-L093: transactional_outbox.redrive_history is documented (db/sql/101)
-- as an append-only audit trail, but nothing enforced that: a direct UPDATE
-- could shrink it (e.g. `SET redrive_history = '[]'::jsonb`) or replace an
-- existing entry, erasing redrive audit history with no trigger or
-- constraint to stop it.
--
-- Fix: a BEFORE UPDATE trigger that rejects a `redrive_history` change unless
-- every existing element is preserved at its original index (array shrinkage
-- or in-place mutation of an existing entry is rejected; a legitimate
-- append -- `redrive_history || jsonb_build_object(...)`, the exact shape
-- OutboxStore.requeueFailed uses in
-- packages/shared/queue-abstraction/src/outbox/pg-outbox-store.ts -- still
-- succeeds because it only adds a new trailing element).
--
-- `@>` was considered and rejected after a quick psql check: jsonb array
-- containment is NOT order-aware --
-- `'[{"a":1},{"a":2}]'::jsonb @> '[{"a":2},{"a":1}]'::jsonb` returns true --
-- so it would accept a reordering/swap of existing entries as if nothing
-- changed. The explicit index-by-index loop below is exact.
--
-- Scope: only the redrive_history column is guarded. status, locked_until,
-- attempts, last_error, available_at, published_at (db/sql/101/220/221) stay
-- fully mutable; the trigger is a no-op whenever redrive_history is
-- unchanged (OLD.redrive_history IS DISTINCT FROM NEW.redrive_history gates
-- the whole check).

CREATE OR REPLACE FUNCTION transactional_outbox_redrive_history_append_only()
RETURNS TRIGGER
LANGUAGE plpgsql
AS $$
DECLARE
  i int;
  old_len int;
  new_len int;
BEGIN
  IF NEW.redrive_history IS NOT DISTINCT FROM OLD.redrive_history THEN
    RETURN NEW;
  END IF;

  IF jsonb_typeof(OLD.redrive_history) IS DISTINCT FROM 'array'
     OR jsonb_typeof(NEW.redrive_history) IS DISTINCT FROM 'array' THEN
    RAISE EXCEPTION
      'transactional_outbox.redrive_history must be a jsonb array (append-only)'
      USING ERRCODE = 'integrity_constraint_violation';
  END IF;

  old_len := jsonb_array_length(OLD.redrive_history);
  new_len := jsonb_array_length(NEW.redrive_history);

  IF new_len < old_len THEN
    RAISE EXCEPTION
      'transactional_outbox.redrive_history is append-only (shrank % -> % entries, id=%)',
      old_len, new_len, OLD.id
      USING ERRCODE = 'integrity_constraint_violation';
  END IF;

  FOR i IN 0 .. old_len - 1 LOOP
    IF NEW.redrive_history -> i IS DISTINCT FROM OLD.redrive_history -> i THEN
      RAISE EXCEPTION
        'transactional_outbox.redrive_history is append-only (entry % mutated, id=%)',
        i, OLD.id
        USING ERRCODE = 'integrity_constraint_violation';
    END IF;
  END LOOP;

  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS trg_transactional_outbox_redrive_history_append_only
  ON transactional_outbox;
CREATE TRIGGER trg_transactional_outbox_redrive_history_append_only
  BEFORE UPDATE OF redrive_history ON transactional_outbox
  FOR EACH ROW EXECUTE FUNCTION transactional_outbox_redrive_history_append_only();

INSERT INTO schema_migrations (filename)
VALUES ('242_outbox_redrive_history_append_only.sql')
ON CONFLICT (filename) DO NOTHING;
