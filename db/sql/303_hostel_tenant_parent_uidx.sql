-- H-D3: parent-side UNIQUE (tenant_id, id) indexes on the five hostel parents
-- (hostels, hostel_blocks, hostel_rooms, hostel_beds, mess_plans) so the hostel
-- child tables can carry tenant-composite (tenant_id, <fk>) -> parent
-- (tenant_id, id) foreign keys. db/sql/304 adds those FKs and validates them.
--
-- Why: every hostel child -> hostel parent FK is id-only (db/sql/008_hostel_schema.sql,
-- db/sql/040_hostel_ops_schema.sql, e.g. `hostel_id UUID NOT NULL REFERENCES
-- hostels(id)`). The RI check runs as the table owner and ignores RLS, so a
-- tenant-A block, room, bed, leave or visitor row could point at a tenant-B
-- parent, and an ON DELETE CASCADE from tenant B's parent could delete tenant
-- A's rows. A composite FK needs a unique index whose columns are exactly
-- (tenant_id, id) on the parent; none of the five parents has one (hostels only
-- has UNIQUE (tenant_id, code)). `id` is already the primary key, so the pair is
-- unique by construction and no duplicate preflight is needed.
--
-- Same pattern as db/sql/254 (W1-DATA-17): a unique index build without a
-- table lock cannot run inside a transaction, so apply-sql.sh applies this file
-- statement-by-statement through the schema_migration_phases ledger. Every
-- statement is idempotent compensating-forward DDL: (1) drop an INVALID
-- leftover from an interrupted build, (2) build, (3) assert present + valid +
-- unique. Lock: SHARE UPDATE EXCLUSIVE per parent for the build only (reads and
-- writes continue). apply-sql.sh's lock_timeout / statement_timeout apply.
--
-- Rollback (forward-only repo; body of a future revert migration, after the
-- db/sql/304 composite FKs that depend on these indexes are dropped):
--   DROP INDEX IF EXISTS <parent>_tenant_id_id_uidx;  -- for each parent above
-- Data loss on rollback: none (index only).
-- hostels
DO $drop_invalid_hostels_tenant_id_id_uidx$
BEGIN
  IF EXISTS (
    SELECT 1
      FROM pg_class c
      JOIN pg_namespace n ON n.oid = c.relnamespace
      JOIN pg_index i ON i.indexrelid = c.oid
     WHERE n.nspname = 'public'
       AND c.relname = 'hostels_tenant_id_id_uidx'
       AND NOT i.indisvalid
  ) THEN
    RAISE NOTICE 'dropping invalid hostels_tenant_id_id_uidx before rebuild';
    EXECUTE 'DROP INDEX IF EXISTS public.hostels_tenant_id_id_uidx';
  END IF;
END
$drop_invalid_hostels_tenant_id_id_uidx$;
CREATE UNIQUE INDEX CONCURRENTLY IF NOT EXISTS hostels_tenant_id_id_uidx
  ON hostels (tenant_id, id);
DO $assert_hostels_tenant_id_id_uidx$
BEGIN
  IF NOT EXISTS (
    SELECT 1
      FROM pg_class c
      JOIN pg_namespace n ON n.oid = c.relnamespace
      JOIN pg_index i ON i.indexrelid = c.oid
     WHERE n.nspname = 'public'
       AND c.relname = 'hostels_tenant_id_id_uidx'
       AND i.indrelid = 'public.hostels'::regclass
       AND i.indisvalid
       AND i.indisunique
       AND i.indnkeyatts = 2
  ) THEN
    RAISE EXCEPTION 'H-D3: hostels_tenant_id_id_uidx missing or not valid/unique';
  END IF;
END
$assert_hostels_tenant_id_id_uidx$;
-- hostel_blocks
DO $drop_invalid_hostel_blocks_tenant_id_id_uidx$
BEGIN
  IF EXISTS (
    SELECT 1
      FROM pg_class c
      JOIN pg_namespace n ON n.oid = c.relnamespace
      JOIN pg_index i ON i.indexrelid = c.oid
     WHERE n.nspname = 'public'
       AND c.relname = 'hostel_blocks_tenant_id_id_uidx'
       AND NOT i.indisvalid
  ) THEN
    RAISE NOTICE 'dropping invalid hostel_blocks_tenant_id_id_uidx before rebuild';
    EXECUTE 'DROP INDEX IF EXISTS public.hostel_blocks_tenant_id_id_uidx';
  END IF;
END
$drop_invalid_hostel_blocks_tenant_id_id_uidx$;
CREATE UNIQUE INDEX CONCURRENTLY IF NOT EXISTS hostel_blocks_tenant_id_id_uidx
  ON hostel_blocks (tenant_id, id);
DO $assert_hostel_blocks_tenant_id_id_uidx$
BEGIN
  IF NOT EXISTS (
    SELECT 1
      FROM pg_class c
      JOIN pg_namespace n ON n.oid = c.relnamespace
      JOIN pg_index i ON i.indexrelid = c.oid
     WHERE n.nspname = 'public'
       AND c.relname = 'hostel_blocks_tenant_id_id_uidx'
       AND i.indrelid = 'public.hostel_blocks'::regclass
       AND i.indisvalid
       AND i.indisunique
       AND i.indnkeyatts = 2
  ) THEN
    RAISE EXCEPTION 'H-D3: hostel_blocks_tenant_id_id_uidx missing or not valid/unique';
  END IF;
END
$assert_hostel_blocks_tenant_id_id_uidx$;
-- hostel_rooms
DO $drop_invalid_hostel_rooms_tenant_id_id_uidx$
BEGIN
  IF EXISTS (
    SELECT 1
      FROM pg_class c
      JOIN pg_namespace n ON n.oid = c.relnamespace
      JOIN pg_index i ON i.indexrelid = c.oid
     WHERE n.nspname = 'public'
       AND c.relname = 'hostel_rooms_tenant_id_id_uidx'
       AND NOT i.indisvalid
  ) THEN
    RAISE NOTICE 'dropping invalid hostel_rooms_tenant_id_id_uidx before rebuild';
    EXECUTE 'DROP INDEX IF EXISTS public.hostel_rooms_tenant_id_id_uidx';
  END IF;
END
$drop_invalid_hostel_rooms_tenant_id_id_uidx$;
CREATE UNIQUE INDEX CONCURRENTLY IF NOT EXISTS hostel_rooms_tenant_id_id_uidx
  ON hostel_rooms (tenant_id, id);
DO $assert_hostel_rooms_tenant_id_id_uidx$
BEGIN
  IF NOT EXISTS (
    SELECT 1
      FROM pg_class c
      JOIN pg_namespace n ON n.oid = c.relnamespace
      JOIN pg_index i ON i.indexrelid = c.oid
     WHERE n.nspname = 'public'
       AND c.relname = 'hostel_rooms_tenant_id_id_uidx'
       AND i.indrelid = 'public.hostel_rooms'::regclass
       AND i.indisvalid
       AND i.indisunique
       AND i.indnkeyatts = 2
  ) THEN
    RAISE EXCEPTION 'H-D3: hostel_rooms_tenant_id_id_uidx missing or not valid/unique';
  END IF;
END
$assert_hostel_rooms_tenant_id_id_uidx$;
-- hostel_beds
DO $drop_invalid_hostel_beds_tenant_id_id_uidx$
BEGIN
  IF EXISTS (
    SELECT 1
      FROM pg_class c
      JOIN pg_namespace n ON n.oid = c.relnamespace
      JOIN pg_index i ON i.indexrelid = c.oid
     WHERE n.nspname = 'public'
       AND c.relname = 'hostel_beds_tenant_id_id_uidx'
       AND NOT i.indisvalid
  ) THEN
    RAISE NOTICE 'dropping invalid hostel_beds_tenant_id_id_uidx before rebuild';
    EXECUTE 'DROP INDEX IF EXISTS public.hostel_beds_tenant_id_id_uidx';
  END IF;
END
$drop_invalid_hostel_beds_tenant_id_id_uidx$;
CREATE UNIQUE INDEX CONCURRENTLY IF NOT EXISTS hostel_beds_tenant_id_id_uidx
  ON hostel_beds (tenant_id, id);
DO $assert_hostel_beds_tenant_id_id_uidx$
BEGIN
  IF NOT EXISTS (
    SELECT 1
      FROM pg_class c
      JOIN pg_namespace n ON n.oid = c.relnamespace
      JOIN pg_index i ON i.indexrelid = c.oid
     WHERE n.nspname = 'public'
       AND c.relname = 'hostel_beds_tenant_id_id_uidx'
       AND i.indrelid = 'public.hostel_beds'::regclass
       AND i.indisvalid
       AND i.indisunique
       AND i.indnkeyatts = 2
  ) THEN
    RAISE EXCEPTION 'H-D3: hostel_beds_tenant_id_id_uidx missing or not valid/unique';
  END IF;
END
$assert_hostel_beds_tenant_id_id_uidx$;
-- mess_plans
DO $drop_invalid_mess_plans_tenant_id_id_uidx$
BEGIN
  IF EXISTS (
    SELECT 1
      FROM pg_class c
      JOIN pg_namespace n ON n.oid = c.relnamespace
      JOIN pg_index i ON i.indexrelid = c.oid
     WHERE n.nspname = 'public'
       AND c.relname = 'mess_plans_tenant_id_id_uidx'
       AND NOT i.indisvalid
  ) THEN
    RAISE NOTICE 'dropping invalid mess_plans_tenant_id_id_uidx before rebuild';
    EXECUTE 'DROP INDEX IF EXISTS public.mess_plans_tenant_id_id_uidx';
  END IF;
END
$drop_invalid_mess_plans_tenant_id_id_uidx$;
CREATE UNIQUE INDEX CONCURRENTLY IF NOT EXISTS mess_plans_tenant_id_id_uidx
  ON mess_plans (tenant_id, id);
DO $assert_mess_plans_tenant_id_id_uidx$
BEGIN
  IF NOT EXISTS (
    SELECT 1
      FROM pg_class c
      JOIN pg_namespace n ON n.oid = c.relnamespace
      JOIN pg_index i ON i.indexrelid = c.oid
     WHERE n.nspname = 'public'
       AND c.relname = 'mess_plans_tenant_id_id_uidx'
       AND i.indrelid = 'public.mess_plans'::regclass
       AND i.indisvalid
       AND i.indisunique
       AND i.indnkeyatts = 2
  ) THEN
    RAISE EXCEPTION 'H-D3: mess_plans_tenant_id_id_uidx missing or not valid/unique';
  END IF;
END
$assert_mess_plans_tenant_id_id_uidx$;
