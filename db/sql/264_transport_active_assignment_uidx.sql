-- PRC-M447: "one active driver assignment per vehicle" and "one active route
-- assignment per student" were check-then-insert in TransportService
-- (findActive*Assignment, then create), and PUT { isActive: true } re-activated
-- an assignment with no check at all. Concurrent creates, or a re-activation,
-- left two active rows.
--
-- These partial unique indexes mirror the service rules exactly:
--   transport_driver_assignments  (tenant_id, vehicle_id) WHERE is_active
--   transport_student_assignments (tenant_id, student_id) WHERE is_active
-- Inactive (ended) rows are unconstrained, so history is unaffected. The
-- repository maps their 23505 to ConflictError (409); the update paths re-run
-- the active check when isActive flips to true.
--
-- Shape (246/253): per table, (1) preflight duplicate count with FORCE RLS
-- lifted and restored inside one DO block (each DO is its own transaction in a
-- CONCURRENTLY file), RAISE on duplicates, never delete data; (2) drop an
-- INVALID leftover; (3) CREATE UNIQUE INDEX CONCURRENTLY IF NOT EXISTS;
-- (4) assert indisvalid AND indisunique. Every statement is idempotent; this
-- file is applied statement-by-statement via schema_migration_phases.
-- Rollback (future forward migration):
--   DROP INDEX IF EXISTS transport_driver_assignments_active_vehicle_uidx;
--   DROP INDEX IF EXISTS transport_student_assignments_active_student_uidx;
DO $m447_preflight_transport_driver_assignments$
DECLARE
  was_forced boolean;
  duplicate_groups bigint;
BEGIN
  SELECT relforcerowsecurity INTO was_forced FROM pg_class WHERE oid = 'public.transport_driver_assignments'::regclass;
  IF was_forced THEN
    ALTER TABLE transport_driver_assignments NO FORCE ROW LEVEL SECURITY;
  END IF;
  SELECT count(*) INTO duplicate_groups
    FROM (SELECT tenant_id, vehicle_id FROM transport_driver_assignments WHERE is_active GROUP BY tenant_id, vehicle_id HAVING count(*) > 1) d;
  IF was_forced THEN
    ALTER TABLE transport_driver_assignments FORCE ROW LEVEL SECURITY;
  END IF;
  IF duplicate_groups > 0 THEN
    RAISE EXCEPTION
      'PRC-M447: % duplicate transport_driver_assignments group(s) on (tenant_id, vehicle_id) WHERE is_active; reconcile before re-running',
      duplicate_groups;
  END IF;
END
$m447_preflight_transport_driver_assignments$;
DO $m447_preflight_transport_student_assignments$
DECLARE
  was_forced boolean;
  duplicate_groups bigint;
BEGIN
  SELECT relforcerowsecurity INTO was_forced FROM pg_class WHERE oid = 'public.transport_student_assignments'::regclass;
  IF was_forced THEN
    ALTER TABLE transport_student_assignments NO FORCE ROW LEVEL SECURITY;
  END IF;
  SELECT count(*) INTO duplicate_groups
    FROM (SELECT tenant_id, student_id FROM transport_student_assignments WHERE is_active GROUP BY tenant_id, student_id HAVING count(*) > 1) d;
  IF was_forced THEN
    ALTER TABLE transport_student_assignments FORCE ROW LEVEL SECURITY;
  END IF;
  IF duplicate_groups > 0 THEN
    RAISE EXCEPTION
      'PRC-M447: % duplicate transport_student_assignments group(s) on (tenant_id, student_id) WHERE is_active; reconcile before re-running',
      duplicate_groups;
  END IF;
END
$m447_preflight_transport_student_assignments$;
DO $m447_drop_invalid_transport_driver_assignments_active_vehicle_uidx$
BEGIN
  IF EXISTS (
    SELECT 1
      FROM pg_class c
      JOIN pg_namespace n ON n.oid = c.relnamespace
      JOIN pg_index i ON i.indexrelid = c.oid
     WHERE n.nspname = 'public'
       AND c.relname = 'transport_driver_assignments_active_vehicle_uidx'
       AND NOT i.indisvalid
  ) THEN
    RAISE NOTICE 'dropping invalid transport_driver_assignments_active_vehicle_uidx before rebuild';
    EXECUTE 'DROP INDEX IF EXISTS public.transport_driver_assignments_active_vehicle_uidx';
  END IF;
END
$m447_drop_invalid_transport_driver_assignments_active_vehicle_uidx$;
CREATE UNIQUE INDEX CONCURRENTLY IF NOT EXISTS transport_driver_assignments_active_vehicle_uidx
  ON transport_driver_assignments (tenant_id, vehicle_id)
  WHERE is_active;
DO $m447_assert_transport_driver_assignments_active_vehicle_uidx$
BEGIN
  IF NOT EXISTS (
    SELECT 1
      FROM pg_class c
      JOIN pg_namespace n ON n.oid = c.relnamespace
      JOIN pg_index i ON i.indexrelid = c.oid
     WHERE n.nspname = 'public'
       AND c.relname = 'transport_driver_assignments_active_vehicle_uidx'
       AND i.indisvalid
       AND i.indisunique
  ) THEN
    RAISE EXCEPTION 'PRC-M447: transport_driver_assignments_active_vehicle_uidx missing or INVALID';
  END IF;
END
$m447_assert_transport_driver_assignments_active_vehicle_uidx$;
DO $m447_drop_invalid_transport_student_assignments_active_student_uidx$
BEGIN
  IF EXISTS (
    SELECT 1
      FROM pg_class c
      JOIN pg_namespace n ON n.oid = c.relnamespace
      JOIN pg_index i ON i.indexrelid = c.oid
     WHERE n.nspname = 'public'
       AND c.relname = 'transport_student_assignments_active_student_uidx'
       AND NOT i.indisvalid
  ) THEN
    RAISE NOTICE 'dropping invalid transport_student_assignments_active_student_uidx before rebuild';
    EXECUTE 'DROP INDEX IF EXISTS public.transport_student_assignments_active_student_uidx';
  END IF;
END
$m447_drop_invalid_transport_student_assignments_active_student_uidx$;
CREATE UNIQUE INDEX CONCURRENTLY IF NOT EXISTS transport_student_assignments_active_student_uidx
  ON transport_student_assignments (tenant_id, student_id)
  WHERE is_active;
DO $m447_assert_transport_student_assignments_active_student_uidx$
BEGIN
  IF NOT EXISTS (
    SELECT 1
      FROM pg_class c
      JOIN pg_namespace n ON n.oid = c.relnamespace
      JOIN pg_index i ON i.indexrelid = c.oid
     WHERE n.nspname = 'public'
       AND c.relname = 'transport_student_assignments_active_student_uidx'
       AND i.indisvalid
       AND i.indisunique
  ) THEN
    RAISE EXCEPTION 'PRC-M447: transport_student_assignments_active_student_uidx missing or INVALID';
  END IF;
END
$m447_assert_transport_student_assignments_active_student_uidx$;
