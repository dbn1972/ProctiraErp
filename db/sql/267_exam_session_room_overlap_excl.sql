-- PRC-M206 (b): the exam room clash rule existed only in app code
-- (clash.ts findRoomClashes, run by PgExamOpsStore.createSessionGuarded under
-- a per-room/date advisory lock). 222 added a lookup index and documented that
-- it does not enforce no-overlap. Any writer that skipped the lock could
-- double-book a room.
--
--   exam_sessions_room_overlap_excl EXCLUDE USING gist (
--     tenant_id WITH =, room_id WITH =,
--     tsrange(session_date + start_time, session_date + end_time, '[)') WITH &&)
--
-- The range is half-open, matching sessionsOverlap()
-- (aStart < bEnd AND bStart < aEnd): back-to-back sessions do not clash. The
-- API accepts HH:MM only (ops-schemas TIME_PATTERN), so the TIME columns carry
-- no seconds and the DB and app comparisons agree. room_id stays free text
-- (mapping to rooms is PRC-M231, needs a decision). PgExamOpsStore maps 23P01
-- to the existing room_overlap conflict result (409 response).
--
-- btree_gist provides gist equality for uuid/text (already created by 248;
-- repeated idempotently). Postgres has no NOT VALID for EXCLUDE, so the ADD is
-- a blocking (ACCESS EXCLUSIVE) build for its duration: waived in
-- tools/scripts/migration-ddl-hazard-waiver.json (exam_sessions is a small
-- per-exam schedule table). The preflight below lifts FORCE RLS for the owner
-- scan and restores it in the same block (the file runs in one transaction),
-- and refuses to add the constraint over existing overlaps (never deletes).
--
-- Invariant: within a tenant, no two exam_sessions rows for the same room_id
-- overlap in [date+start, date+end).
-- Rollback (future forward migration):
--   ALTER TABLE exam_sessions DROP CONSTRAINT IF EXISTS exam_sessions_room_overlap_excl;
CREATE EXTENSION IF NOT EXISTS btree_gist;
DO $m206_exam_preflight$
DECLARE
  was_forced boolean;
  overlap_count bigint;
BEGIN
  SELECT relforcerowsecurity INTO was_forced FROM pg_class WHERE oid = 'public.exam_sessions'::regclass;
  IF was_forced THEN
    ALTER TABLE exam_sessions NO FORCE ROW LEVEL SECURITY;
  END IF;
  SELECT count(*) INTO overlap_count
    FROM exam_sessions a
    JOIN exam_sessions b
      ON a.tenant_id = b.tenant_id
     AND a.room_id = b.room_id
     AND a.id < b.id
     AND tsrange(a.session_date + a.start_time, a.session_date + a.end_time, '[)')
      && tsrange(b.session_date + b.start_time, b.session_date + b.end_time, '[)');
  IF was_forced THEN
    ALTER TABLE exam_sessions FORCE ROW LEVEL SECURITY;
  END IF;
  IF overlap_count > 0 THEN
    RAISE EXCEPTION
      'PRC-M206: % overlapping exam_sessions room booking pair(s) exist; reconcile before re-running',
      overlap_count;
  END IF;
END
$m206_exam_preflight$;
ALTER TABLE exam_sessions DROP CONSTRAINT IF EXISTS exam_sessions_room_overlap_excl;
ALTER TABLE exam_sessions
  ADD CONSTRAINT exam_sessions_room_overlap_excl
  EXCLUDE USING gist (
    tenant_id WITH =,
    room_id WITH =,
    tsrange(session_date + start_time, session_date + end_time, '[)') WITH &&
  );
