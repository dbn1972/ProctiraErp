-- PRC-M362: outbox claim lease (visibility timeout) so concurrent relays on
-- 2+ replicas cannot double-claim the same row, and a relay that crashes
-- between claim and markPublished/markFailed releases its claim after the
-- lease expires.
--
-- Design: claimPending moves a row to status='processing' and stamps
-- locked_until = now() + lease. The pending selection also reclaims rows whose
-- lease has expired (status='processing' AND locked_until <= now()).
-- markPublished / markFailed transition the row out of 'processing' as before.
--
-- Online safety: one ADD COLUMN of a nullable column (no default) records
-- nothing to rewrite, taking ACCESS EXCLUSIVE only briefly. The status CHECK is
-- WIDENED (adds 'processing'); every existing row is 'pending' | 'published' |
-- 'failed', all of which still satisfy the new predicate, so the ADD CONSTRAINT
-- validation scan cannot fail and no NOT VALID / VALIDATE window is required.
--
-- The lease-reclaim index is built in 221_outbox_lease_index.sql, which must run
-- outside a transaction (CONCURRENTLY), per db/README.md.

ALTER TABLE transactional_outbox
  ADD COLUMN IF NOT EXISTS locked_until TIMESTAMPTZ;

COMMENT ON COLUMN transactional_outbox.locked_until IS
  'Lease expiry for an in-flight claim (PRC-M362). Set when a relay claims a '
  'row (status=processing); the row is reclaimable once now() > locked_until. '
  'NULL for pending/published/failed rows. Never published to the broker.';

-- Widen the status domain to include the in-flight lease state. Drop the old
-- constraint by its catalog name if present, then (re)create the broader one.
DO $widen_outbox_status_check$
DECLARE
  con_name text;
BEGIN
  SELECT c.conname INTO con_name
    FROM pg_constraint c
    JOIN pg_class t ON t.oid = c.conrelid
    JOIN pg_namespace n ON n.oid = t.relnamespace
   WHERE n.nspname = 'public'
     AND t.relname = 'transactional_outbox'
     AND c.contype = 'c'
     AND pg_get_constraintdef(c.oid) ILIKE '%status%'
     AND pg_get_constraintdef(c.oid) NOT ILIKE '%processing%'
   LIMIT 1;

  IF con_name IS NOT NULL THEN
    EXECUTE format(
      'ALTER TABLE transactional_outbox DROP CONSTRAINT %I',
      con_name
    );
  END IF;

  IF NOT EXISTS (
    SELECT 1
      FROM pg_constraint c
      JOIN pg_class t ON t.oid = c.conrelid
      JOIN pg_namespace n ON n.oid = t.relnamespace
     WHERE n.nspname = 'public'
       AND t.relname = 'transactional_outbox'
       AND c.conname = 'transactional_outbox_status_check'
  ) THEN
    -- Add NOT VALID first (brief ACCESS EXCLUSIVE, no scan), then VALIDATE.
    -- The predicate WIDENS the old domain so every existing row already
    -- satisfies it; VALIDATE here cannot fail. The table is FORCE ROW LEVEL
    -- SECURITY, so VALIDATE must run with FORCE lifted (and restored in the
    -- same transaction) or the scan runs under the tenant policy, sees zero
    -- rows and validates nothing — the db/sql/100 pattern.
    ALTER TABLE transactional_outbox
      ADD CONSTRAINT transactional_outbox_status_check
      CHECK (status IN ('pending', 'processing', 'published', 'failed')) NOT VALID;
    ALTER TABLE transactional_outbox NO FORCE ROW LEVEL SECURITY;
    ALTER TABLE transactional_outbox
      VALIDATE CONSTRAINT transactional_outbox_status_check;
    ALTER TABLE transactional_outbox FORCE ROW LEVEL SECURITY;
  END IF;
END
$widen_outbox_status_check$;

DO $assert_outbox_lease$
BEGIN
  IF NOT EXISTS (
    SELECT 1
      FROM information_schema.columns
     WHERE table_schema = 'public'
       AND table_name = 'transactional_outbox'
       AND column_name = 'locked_until'
  ) THEN
    RAISE EXCEPTION 'PRC-M362: transactional_outbox.locked_until is missing';
  END IF;

  -- The lease path depends on 'processing' being permitted by the status CHECK.
  BEGIN
    PERFORM 1 FROM transactional_outbox WHERE status = 'processing' LIMIT 1;
  EXCEPTION
    WHEN others THEN
      RAISE EXCEPTION 'PRC-M362: outbox status domain does not permit processing';
  END;
END
$assert_outbox_lease$;
