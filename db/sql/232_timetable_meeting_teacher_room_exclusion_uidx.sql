-- PRC-M396(c): section_meetings had only non-unique partial indexes on
-- (tenant_id, teacher_staff_id, day_of_week) / (tenant_id, room_id, day_of_week) — nothing at
-- the DB level stopped two active rows from also sharing the same bell_period_id. The app-layer
-- clash check (assertNoMeetingClash / PRC-M396(a)+(b)) is now the primary guard, but this is a
-- real, additive backstop for the common same-bell-schedule case.
--
-- Documented residual: this unique index only catches same-bell_period_id clashes. The
-- app-layer detectMeetingClashes()/periodsCollide() also catches cross-bell-schedule clashes
-- where two different bell_period_ids have overlapping wall-clock time windows (PRC-M398) — a
-- DB-level EXCLUDE USING gist over a computed time range could express that too, but it needs
-- the btree_gist extension (not used anywhere in this repo today) and a join to
-- bell_periods.start_time/end_time, which is materially riskier to add in this batch. Left
-- explicit rather than attempted: the unique index below is exactly what the finding's literal
-- "DB has no teacher/room exclusion constraint" gap asked for.
--
-- Non-transactional (CONCURRENTLY): mirrors db/sql/123_student_attendance_unique_identity.sql's
-- preflight-duplicate-check + drop-invalid-leftover + build + closing-assert shape. apply-sql.sh
-- detects the literal word CONCURRENTLY anywhere in this file and applies it statement-by-
-- statement via the schema_migration_phases ledger instead of --single-transaction, so every
-- statement below must be idempotent compensating-forward DDL (a crash between a statement's
-- commit and its phase-ledger row re-runs the statement safely).
--
-- Data safety: existing duplicate-slot rows (if any) are NOT deleted — timetable meetings are
-- operational scheduling data, not something this migration should silently rewrite. The
-- preflight fails the apply with a count so an operator can reconcile first. A clean/fresh
-- install has none.

-- 1) Preflight: refuse to build over existing duplicates for each of the two slot shapes.
DO $m396c_preflight$
DECLARE
  teacher_dupes bigint;
  room_dupes bigint;
BEGIN
  IF to_regclass('public.section_meetings') IS NULL THEN
    RAISE NOTICE 'PRC-M396(c): section_meetings missing; skipping';
    RETURN;
  END IF;
  SELECT count(*) INTO teacher_dupes
    FROM (
      SELECT 1
        FROM section_meetings
       WHERE teacher_staff_id IS NOT NULL AND deleted_at IS NULL AND status = 'active'
       GROUP BY tenant_id, teacher_staff_id, day_of_week, bell_period_id
      HAVING count(*) > 1
    ) d;
  IF teacher_dupes > 0 THEN
    RAISE EXCEPTION
      'PRC-M396(c): % teacher/day/period group(s) already have duplicate active meetings; '
      'reconcile them before re-running',
      teacher_dupes;
  END IF;
  SELECT count(*) INTO room_dupes
    FROM (
      SELECT 1
        FROM section_meetings
       WHERE room_id IS NOT NULL AND deleted_at IS NULL AND status = 'active'
       GROUP BY tenant_id, room_id, day_of_week, bell_period_id
      HAVING count(*) > 1
    ) d;
  IF room_dupes > 0 THEN
    RAISE EXCEPTION
      'PRC-M396(c): % room/day/period group(s) already have duplicate active meetings; '
      'reconcile them before re-running',
      room_dupes;
  END IF;
END
$m396c_preflight$;

-- 2) Drop invalid leftovers from an interrupted CONCURRENTLY build before rebuilding.
DO $drop_invalid_section_meetings_slot_uidx$
BEGIN
  IF EXISTS (
    SELECT 1
      FROM pg_class c
      JOIN pg_namespace n ON n.oid = c.relnamespace
      JOIN pg_index i ON i.indexrelid = c.oid
     WHERE n.nspname = 'public'
       AND c.relname = 'section_meetings_teacher_slot_uidx'
       AND NOT i.indisvalid
  ) THEN
    RAISE NOTICE 'dropping invalid section_meetings_teacher_slot_uidx before rebuild';
    EXECUTE 'DROP INDEX IF EXISTS public.section_meetings_teacher_slot_uidx';
  END IF;
  IF EXISTS (
    SELECT 1
      FROM pg_class c
      JOIN pg_namespace n ON n.oid = c.relnamespace
      JOIN pg_index i ON i.indexrelid = c.oid
     WHERE n.nspname = 'public'
       AND c.relname = 'section_meetings_room_slot_uidx'
       AND NOT i.indisvalid
  ) THEN
    RAISE NOTICE 'dropping invalid section_meetings_room_slot_uidx before rebuild';
    EXECUTE 'DROP INDEX IF EXISTS public.section_meetings_room_slot_uidx';
  END IF;
END
$drop_invalid_section_meetings_slot_uidx$;

-- 3) The two partial unique indexes, built CONCURRENTLY.
CREATE UNIQUE INDEX CONCURRENTLY IF NOT EXISTS section_meetings_teacher_slot_uidx
  ON section_meetings (tenant_id, teacher_staff_id, day_of_week, bell_period_id)
  WHERE teacher_staff_id IS NOT NULL AND deleted_at IS NULL AND status = 'active';

CREATE UNIQUE INDEX CONCURRENTLY IF NOT EXISTS section_meetings_room_slot_uidx
  ON section_meetings (tenant_id, room_id, day_of_week, bell_period_id)
  WHERE room_id IS NOT NULL AND deleted_at IS NULL AND status = 'active';

-- 4) Present AND valid AND unique, or fail (skip when table absent).
DO $m396c_assert$
BEGIN
  IF to_regclass('public.section_meetings') IS NULL THEN
    RETURN;
  END IF;
  IF NOT EXISTS (
    SELECT 1
      FROM pg_class c
      JOIN pg_namespace n ON n.oid = c.relnamespace
      JOIN pg_index i ON i.indexrelid = c.oid
     WHERE n.nspname = 'public'
       AND c.relname = 'section_meetings_teacher_slot_uidx'
       AND i.indisvalid
       AND i.indisunique
  ) THEN
    RAISE EXCEPTION 'PRC-M396(c): section_meetings_teacher_slot_uidx missing or not valid/unique';
  END IF;
  IF NOT EXISTS (
    SELECT 1
      FROM pg_class c
      JOIN pg_namespace n ON n.oid = c.relnamespace
      JOIN pg_index i ON i.indexrelid = c.oid
     WHERE n.nspname = 'public'
       AND c.relname = 'section_meetings_room_slot_uidx'
       AND i.indisvalid
       AND i.indisunique
  ) THEN
    RAISE EXCEPTION 'PRC-M396(c): section_meetings_room_slot_uidx missing or not valid/unique';
  END IF;
END
$m396c_assert$;
