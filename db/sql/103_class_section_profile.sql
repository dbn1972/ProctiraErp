-- Class section profile: class teacher and room shown on the institution Classes tab.
-- Additive and idempotent. Teacher must belong to the same tenant.
-- The foreign key is attached NOT VALID, then validated with FORCE RLS lifted
-- for the scan and restored in the same statement (see 098).

ALTER TABLE classes
  ADD COLUMN IF NOT EXISTS class_teacher_staff_id UUID;

ALTER TABLE classes
  ADD COLUMN IF NOT EXISTS room_name VARCHAR(120);

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint WHERE conname = 'classes_class_teacher_staff_id_fkey'
  ) THEN
    ALTER TABLE classes
      ADD CONSTRAINT classes_class_teacher_staff_id_fkey
      FOREIGN KEY (class_teacher_staff_id) REFERENCES staff(id) NOT VALID;
  END IF;
END $$;

DO $validate_class_teacher_fk$
DECLARE
  was_forced boolean;
BEGIN
  SELECT relforcerowsecurity
    INTO was_forced
    FROM pg_class
   WHERE oid = 'public.classes'::regclass;

  IF was_forced THEN
    ALTER TABLE classes NO FORCE ROW LEVEL SECURITY;
  END IF;

  ALTER TABLE classes VALIDATE CONSTRAINT classes_class_teacher_staff_id_fkey;

  IF was_forced THEN
    ALTER TABLE classes FORCE ROW LEVEL SECURITY;
  END IF;
END
$validate_class_teacher_fk$;

INSERT INTO schema_migrations (filename)
VALUES ('103_class_section_profile.sql')
ON CONFLICT (filename) DO NOTHING;
