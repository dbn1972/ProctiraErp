-- Class section profile: class teacher and room shown on the institution Classes tab.
-- Additive and idempotent. Teacher must belong to the same tenant.

ALTER TABLE classes
  ADD COLUMN IF NOT EXISTS class_teacher_staff_id UUID,
  ADD COLUMN IF NOT EXISTS room_name VARCHAR(120);

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint WHERE conname = 'classes_class_teacher_staff_id_fkey'
  ) THEN
    ALTER TABLE classes
      ADD CONSTRAINT classes_class_teacher_staff_id_fkey
      FOREIGN KEY (class_teacher_staff_id) REFERENCES staff(id);
  END IF;
END $$;

CREATE INDEX IF NOT EXISTS classes_tenant_teacher_idx
  ON classes (tenant_id, class_teacher_staff_id)
  WHERE class_teacher_staff_id IS NOT NULL AND deleted_at IS NULL;

INSERT INTO schema_migrations (filename)
VALUES ('103_class_section_profile.sql')
ON CONFLICT (filename) DO NOTHING;
