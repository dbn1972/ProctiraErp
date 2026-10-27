-- PRC-M449: transport_gps_pings.vehicle_id and transport_bus_attendance.route_id
-- were declared ON DELETE CASCADE (045:31, 045:51). A hard DELETE of a vehicle
-- or route (pg-transport-repository deleteVehicle / deleteRoute) silently wiped
-- its GPS trail and bus-attendance history; every other dependent FK made the
-- same DELETE fail with 23503, which surfaced as a 500.
--
-- This swaps the two history FKs to ON DELETE RESTRICT, in one transaction:
--   1. ADD CONSTRAINT *_restrict_fk ... ON DELETE RESTRICT NOT VALID;
--   2. DROP the existing CASCADE FK(s) on the same column, looked up from
--      pg_constraint (045's default name is <table>_<col>_fkey).
-- The swap is atomic (one transaction), so there is no window without an FK,
-- and the net effect is stricter. The repository now maps 23503 on
-- deleteVehicle / deleteRoute / deleteStop to ConflictError (409, "deactivate
-- instead"). Device and alert cascades are unchanged (they are not history).
--
-- The new FKs stay NOT VALID on purpose:
--   * RESTRICT is enforced by the parent-side RI triggers for every DELETE,
--     validated or not, and new child rows are checked on INSERT/UPDATE.
--   * Existing rows were already proven by the validated CASCADE FK this
--     replaces (same columns, same parent).
--   * A VALIDATE would have to lift FORCE RLS (W1-DATA-18) and hold ACCESS
--     EXCLUSIVE on the unbounded transport_gps_pings for the whole scan
--     (retention/partitioning is PRC-L092, blocked). Residual note, not a defect.
--
-- Invariant: deleting a vehicle with GPS pings, or a route with bus-attendance
-- rows, fails (23503); history rows are never removed by a parent delete.
-- Idempotent: each ADD is guarded by a pg_constraint lookup; the drop loop
-- only touches CASCADE FKs on the exact column/parent.
-- Rollback (future forward migration, one transaction): re-add
--   transport_gps_pings_vehicle_id_fkey / transport_bus_attendance_route_id_fkey
--   ... ON DELETE CASCADE NOT VALID, then DROP CONSTRAINT IF EXISTS
--   transport_gps_pings_vehicle_restrict_fk, transport_bus_attendance_route_restrict_fk.
DO $m449_add_restrict$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint
     WHERE conrelid = 'public.transport_gps_pings'::regclass
       AND conname = 'transport_gps_pings_vehicle_restrict_fk'
  ) THEN
    ALTER TABLE transport_gps_pings
      ADD CONSTRAINT transport_gps_pings_vehicle_restrict_fk
      FOREIGN KEY (vehicle_id) REFERENCES transport_vehicles(id) ON DELETE RESTRICT NOT VALID;
  END IF;
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint
     WHERE conrelid = 'public.transport_bus_attendance'::regclass
       AND conname = 'transport_bus_attendance_route_restrict_fk'
  ) THEN
    ALTER TABLE transport_bus_attendance
      ADD CONSTRAINT transport_bus_attendance_route_restrict_fk
      FOREIGN KEY (route_id) REFERENCES transport_routes(id) ON DELETE RESTRICT NOT VALID;
  END IF;
END
$m449_add_restrict$;
DO $m449_drop_cascade$
DECLARE
  r record;
  dropped int := 0;
BEGIN
  FOR r IN
    SELECT c.conrelid::regclass AS tbl, c.conname
      FROM pg_constraint c
      JOIN pg_attribute a ON a.attrelid = c.conrelid AND a.attnum = c.conkey[1]
     WHERE c.contype = 'f'
       AND c.confdeltype = 'c'
       AND array_length(c.conkey, 1) = 1
       AND (
         (c.conrelid = 'public.transport_gps_pings'::regclass
           AND c.confrelid = 'public.transport_vehicles'::regclass AND a.attname = 'vehicle_id')
         OR
         (c.conrelid = 'public.transport_bus_attendance'::regclass
           AND c.confrelid = 'public.transport_routes'::regclass AND a.attname = 'route_id')
       )
  LOOP
    EXECUTE format('ALTER TABLE %s DROP CONSTRAINT %I', r.tbl, r.conname);
    dropped := dropped + 1;
  END LOOP;
  RAISE NOTICE 'PRC-M449: dropped % CASCADE history FK(s)', dropped;
END
$m449_drop_cascade$;
DO $m449_assert$
BEGIN
  IF EXISTS (
    SELECT 1 FROM pg_constraint c
     WHERE c.contype = 'f' AND c.confdeltype = 'c'
       AND ((c.conrelid = 'public.transport_gps_pings'::regclass
             AND c.confrelid = 'public.transport_vehicles'::regclass)
         OR (c.conrelid = 'public.transport_bus_attendance'::regclass
             AND c.confrelid = 'public.transport_routes'::regclass))
  ) THEN
    RAISE EXCEPTION 'PRC-M449: a CASCADE history FK is still present';
  END IF;
  IF (SELECT count(*) FROM pg_constraint
       WHERE conname IN ('transport_gps_pings_vehicle_restrict_fk',
                         'transport_bus_attendance_route_restrict_fk')
         AND contype = 'f' AND confdeltype = 'r') <> 2 THEN
    RAISE EXCEPTION 'PRC-M449: RESTRICT history FKs missing';
  END IF;
END
$m449_assert$;
