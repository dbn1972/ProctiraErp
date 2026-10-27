-- PRC-M381: staff offboard state lives only in the user-writable custom_data
-- JSON (custom_data->'__offboard'), and StaffService.offboard is a read,
-- check, then write with no version or condition: two concurrent offboards
-- both pass the "not yet offboarded" check and both write.
--
-- Fix: first-class nullable columns on staff that the service writes with ONE
-- conditional UPDATE (... WHERE offboard_status IS NULL), so exactly one
-- offboard wins and the loser gets a 409:
--   offboard_status          TEXT        NULL | 'offboarded'
--   offboarded_at            TIMESTAMPTZ when the decision was recorded
--   offboard_effective_date  DATE        effective date from the request
--   offboard_reason          TEXT
--   offboarded_by            TEXT        deciding principal
-- staff_offboard_status_chk is added NOT VALID, existing rows are backfilled
-- from custom_data->'__offboard' (FORCE ROW LEVEL SECURITY lifted and restored
-- in the same transaction so the owner sees every tenant's rows), then the
-- CHECK is VALIDATEd. custom_data->'__offboard' is still written by the
-- service for backward compatibility; the API response shape is unchanged.
--
-- Backfill rule: only rows whose JSON says status = 'offboarded' and whose
-- columns are still NULL. A malformed effectiveDate / decidedAt in the JSON
-- backfills that column as NULL (never fails the deploy, never invents data).
--
-- Locks (PR rollout note): ADD COLUMN without default is catalog-only; lifting
-- FORCE takes ACCESS EXCLUSIVE on staff until COMMIT; the backfill touches only
-- offboarded rows; VALIDATE scans staff. Bounded by apply-sql.sh lock_timeout.
--
-- Idempotent: IF NOT EXISTS columns, guarded ADD CONSTRAINT, backfill only
-- touches rows with NULL offboard_status, VALIDATE on a valid CHECK is a no-op.
--
-- Rollback (forward-only repo; body of a future revert migration, after the
-- service/Prisma revert):
--   ALTER TABLE staff DROP CONSTRAINT IF EXISTS staff_offboard_status_chk,
--     DROP COLUMN IF EXISTS offboard_status, DROP COLUMN IF EXISTS offboarded_at,
--     DROP COLUMN IF EXISTS offboard_effective_date,
--     DROP COLUMN IF EXISTS offboard_reason, DROP COLUMN IF EXISTS offboarded_by;
-- Data loss on rollback: none (custom_data->'__offboard' still holds the state).

ALTER TABLE staff ADD COLUMN IF NOT EXISTS offboard_status TEXT;
ALTER TABLE staff ADD COLUMN IF NOT EXISTS offboarded_at TIMESTAMPTZ;
ALTER TABLE staff ADD COLUMN IF NOT EXISTS offboard_effective_date DATE;
ALTER TABLE staff ADD COLUMN IF NOT EXISTS offboard_reason TEXT;
ALTER TABLE staff ADD COLUMN IF NOT EXISTS offboarded_by TEXT;

DO $prc_m381_add_check$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint
     WHERE conrelid = 'public.staff'::regclass
       AND conname = 'staff_offboard_status_chk'
  ) THEN
    ALTER TABLE public.staff
      ADD CONSTRAINT staff_offboard_status_chk
      CHECK (offboard_status IS NULL OR offboard_status = 'offboarded') NOT VALID;
  END IF;
END
$prc_m381_add_check$;

DO $prc_m381_backfill_validate$
DECLARE
  was_forced boolean;
  r record;
  eff date;
  decided timestamptz;
  backfilled int := 0;
BEGIN
  SELECT relforcerowsecurity INTO was_forced FROM pg_class WHERE oid = 'public.staff'::regclass;
  IF was_forced THEN
    ALTER TABLE public.staff NO FORCE ROW LEVEL SECURITY;
  END IF;

  FOR r IN
    SELECT id, custom_data -> '__offboard' AS meta
      FROM public.staff
     WHERE offboard_status IS NULL
       AND custom_data -> '__offboard' ->> 'status' = 'offboarded'
  LOOP
    BEGIN
      eff := (r.meta ->> 'effectiveDate')::date;
    EXCEPTION WHEN others THEN
      eff := NULL;
    END;
    BEGIN
      decided := (r.meta ->> 'decidedAt')::timestamptz;
    EXCEPTION WHEN others THEN
      decided := NULL;
    END;
    UPDATE public.staff
       SET offboard_status = 'offboarded',
           offboarded_at = decided,
           offboard_effective_date = eff,
           offboard_reason = r.meta ->> 'reason',
           offboarded_by = r.meta ->> 'decidedBy'
     WHERE id = r.id;
    backfilled := backfilled + 1;
  END LOOP;

  ALTER TABLE public.staff VALIDATE CONSTRAINT staff_offboard_status_chk;

  IF was_forced THEN
    ALTER TABLE public.staff FORCE ROW LEVEL SECURITY;
  END IF;

  IF was_forced AND NOT (SELECT relforcerowsecurity FROM pg_class WHERE oid = 'public.staff'::regclass) THEN
    RAISE EXCEPTION 'PRC-M381: FORCE ROW LEVEL SECURITY not restored on staff';
  END IF;
  IF EXISTS (
    SELECT 1 FROM pg_constraint
     WHERE conrelid = 'public.staff'::regclass
       AND conname = 'staff_offboard_status_chk'
       AND NOT convalidated
  ) THEN
    RAISE EXCEPTION 'PRC-M381: staff_offboard_status_chk still NOT VALID';
  END IF;
  RAISE NOTICE 'PRC-M381: backfilled % offboarded staff row(s) from custom_data', backfilled;
END
$prc_m381_backfill_validate$;
