-- PRC-M400: section_meetings has no subject_id column, so PgTimetableRepository
-- silently drops the subject a meeting was created for (mapMeeting() hardcodes
-- subjectId: null; MEETING_INSERT_SQL/updateMeeting never write it). The
-- in-memory repository has no such gap because it stores the whole entity.
--
-- Additive, nullable column: existing rows get NULL ("no subject recorded"),
-- a valid state, so no backfill is needed. Mirrors
-- db/sql/103_class_section_profile.sql's NOT VALID -> VALIDATE pattern.
-- section_meetings is NOT FORCE ROW LEVEL SECURITY (confirmed in
-- db/sql/015_rls_policies.sql: ENABLE only), so no FORCE-lift/restore dance
-- (098/103's was_forced guard) is needed around VALIDATE CONSTRAINT here.

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

ALTER TABLE section_meetings VALIDATE CONSTRAINT section_meetings_subject_id_fkey;

INSERT INTO schema_migrations (filename)
VALUES ('230_timetable_section_meeting_subject_persist.sql')
ON CONFLICT (filename) DO NOTHING;
