-- PRC-M373: staff leave rules: no overlap check and no cancel/restore.
--
-- 1. Overlap. Nothing stopped one staff member holding two pending/approved
--    leaves over the same days, so an approval could debit the same day
--    twice. The service now maps the violation to 409; this EXCLUDE makes the
--    rule hold for every writer, including concurrent creates that both pass
--    a read-then-insert check:
--
--      staff_leave_requests_no_overlap_excl EXCLUDE USING gist (
--        tenant_id WITH =, staff_id WITH =,
--        daterange(start_date, end_date, '[]') WITH &&)
--        WHERE (status IN ('pending', 'approved'))
--
--    Leave ranges are inclusive ('[]'), so a leave ending on the 10th and one
--    starting on the 10th overlap. Rejected and cancelled rows never block.
--    btree_gist provides gist equality for uuid (already created by 248).
--    Postgres has no NOT VALID for EXCLUDE, so the ADD is a blocking build;
--    waived in tools/scripts/migration-ddl-hazard-waiver.json (per-staff HR
--    table, no seed rows). The preflight lifts FORCE RLS for the owner scan,
--    restores it in the same block, and refuses to add the constraint over
--    existing overlaps (it never deletes or edits data).
--
-- 2. Cancel. POST /staff/leaves/:id/cancel sets status 'cancelled' (already
--    allowed by the 013 CHECK) and, for an approved balance-tracked leave,
--    credits the debited days back in the same transaction. cancelled_by /
--    cancelled_at record who cancelled and when; decided_by / decided_at keep
--    the original decision.
--
-- Rollback (future forward migration):
--   ALTER TABLE staff_leave_requests DROP CONSTRAINT IF EXISTS staff_leave_requests_no_overlap_excl;
CREATE EXTENSION IF NOT EXISTS btree_gist;

ALTER TABLE staff_leave_requests ADD COLUMN IF NOT EXISTS cancelled_by TEXT;
ALTER TABLE staff_leave_requests ADD COLUMN IF NOT EXISTS cancelled_at TIMESTAMPTZ;
COMMENT ON COLUMN staff_leave_requests.cancelled_by IS
  'PRC-M373: JWT subject that cancelled the leave (status cancelled).';
COMMENT ON COLUMN staff_leave_requests.cancelled_at IS
  'PRC-M373: when the leave was cancelled.';

DO $m373_preflight$
DECLARE
  was_forced boolean;
  overlap_count bigint;
BEGIN
  SELECT relforcerowsecurity INTO was_forced
    FROM pg_class WHERE oid = 'public.staff_leave_requests'::regclass;
  IF was_forced THEN
    ALTER TABLE staff_leave_requests NO FORCE ROW LEVEL SECURITY;
  END IF;
  SELECT count(*) INTO overlap_count
    FROM staff_leave_requests a
    JOIN staff_leave_requests b
      ON a.tenant_id = b.tenant_id
     AND a.staff_id = b.staff_id
     AND a.id < b.id
     AND a.status IN ('pending', 'approved')
     AND b.status IN ('pending', 'approved')
     AND daterange(a.start_date, a.end_date, '[]') && daterange(b.start_date, b.end_date, '[]');
  IF was_forced THEN
    ALTER TABLE staff_leave_requests FORCE ROW LEVEL SECURITY;
  END IF;
  IF overlap_count > 0 THEN
    RAISE EXCEPTION
      'PRC-M373: % overlapping pending/approved staff leave pair(s) exist; cancel or reject one of each pair before re-running',
      overlap_count;
  END IF;
END
$m373_preflight$;

ALTER TABLE staff_leave_requests DROP CONSTRAINT IF EXISTS staff_leave_requests_no_overlap_excl;
ALTER TABLE staff_leave_requests
  ADD CONSTRAINT staff_leave_requests_no_overlap_excl
  EXCLUDE USING gist (
    tenant_id WITH =,
    staff_id WITH =,
    daterange(start_date, end_date, '[]') WITH &&
  )
  WHERE (status IN ('pending', 'approved'));
