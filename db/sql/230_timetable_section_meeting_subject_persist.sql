-- PRC-M400: section_meetings has no subject_id column, so PgTimetableRepository
-- silently drops the subject a meeting was created for (mapMeeting() hardcodes
-- subjectId: null; MEETING_INSERT_SQL/updateMeeting never write it). The
-- in-memory repository has no such gap because it stores the whole entity.
--
-- Additive, nullable column: existing rows get NULL ("no subject recorded"),
-- a valid state, so no backfill is needed. Mirrors
-- db/sql/103_class_section_profile.sql's NOT VALID -> VALIDATE pattern.
-- section_meetings is ENABLE-only at db/sql/015 (db/sql/015_rls_policies.sql),
-- but db/sql/051_force_rls_invariant.sql's catch-all loop FORCEs every
-- RLS-enabled public table (including section_meetings) before this file
-- runs in LC_ALL=C order, so by the time 230 runs the table IS forced.
-- VALIDATE CONSTRAINT must therefore lift FORCE ROW LEVEL SECURITY for the
-- scan and restore it in the same transaction (same was_forced guard as
-- db/sql/103_class_section_profile.sql / db/sql/098 / db/sql/100), otherwise
-- the scan runs under the tenant policy, sees zero rows, and validates
-- nothing.

ALTER TABLE section_meetings
  ADD COLUMN IF NOT EXISTS subject_id UUID;

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint WHERE conname = 'section_meetings_subject_id_fkey'
  ) THEN
    ALTER TABLE section_meetings
      ADD CONSTRAINT section_meetings_subject_id_fkey
      FOREIGN KEY (subject_id) REFERENCES subjects(id) NOT VALID;
  END IF;
END $$;

DO $validate_section_meetings_subject_fk$
DECLARE
  was_forced boolean;
BEGIN
  SELECT relforcerowsecurity
    INTO was_forced
    FROM pg_class
   WHERE oid = 'public.section_meetings'::regclass;

  IF was_forced THEN
    ALTER TABLE section_meetings NO FORCE ROW LEVEL SECURITY;
  END IF;

  ALTER TABLE section_meetings VALIDATE CONSTRAINT section_meetings_subject_id_fkey;

  IF was_forced THEN
    ALTER TABLE section_meetings FORCE ROW LEVEL SECURITY;
  END IF;
END
$validate_section_meetings_subject_fk$;

INSERT INTO schema_migrations (filename)
VALUES ('230_timetable_section_meeting_subject_persist.sql')
ON CONFLICT (filename) DO NOTHING;
