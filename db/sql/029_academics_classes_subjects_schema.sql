-- Wave 9 (G-901 follow-up) — classes / subjects / institution_subjects.
--
-- The Prisma models `Class`, `Subject` and `InstitutionSubject` (schema.prisma)
-- had no backing migration: `academic_periods` and `grades` come from
-- 001_core_onboarding_schema.sql, but `prisma.class.findMany()` failed with
-- "The table public.classes does not exist" on a freshly migrated database,
-- which broke the mounted `/classes`, `/subjects` and `/institution-subjects`
-- routes and the institution Classes tab. Column names mirror the @map()s.
--
-- RLS follows 015/021: tenant_isolation on app.tenant_id, FORCE so the owner
-- role cannot bypass; platform_admin passthrough matches the enrollments table.

CREATE TABLE IF NOT EXISTS classes (
  id                 UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  tenant_id          UUID NOT NULL REFERENCES tenants(id),
  institution_id     UUID NOT NULL REFERENCES institutions(id),
  grade_id           UUID NOT NULL REFERENCES grades(id),
  academic_period_id UUID NOT NULL REFERENCES academic_periods(id),
  name               VARCHAR(100) NOT NULL,
  capacity           SMALLINT,
  created_at         TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at         TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  deleted_at         TIMESTAMPTZ
);
CREATE INDEX IF NOT EXISTS classes_tenant_institution_period_idx
  ON classes (tenant_id, institution_id, academic_period_id);
CREATE INDEX IF NOT EXISTS classes_tenant_grade_idx
  ON classes (tenant_id, grade_id);

CREATE TABLE IF NOT EXISTS subjects (
  id         UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  tenant_id  UUID NOT NULL REFERENCES tenants(id),
  name       VARCHAR(255) NOT NULL,
  code       VARCHAR(50) NOT NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  deleted_at TIMESTAMPTZ,
  UNIQUE (tenant_id, code)
);
CREATE INDEX IF NOT EXISTS subjects_tenant_idx ON subjects (tenant_id);

CREATE TABLE IF NOT EXISTS institution_subjects (
  id             UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  tenant_id      UUID NOT NULL REFERENCES tenants(id),
  institution_id UUID NOT NULL REFERENCES institutions(id),
  subject_id     UUID NOT NULL REFERENCES subjects(id),
  grade_id       UUID NOT NULL REFERENCES grades(id),
  created_at     TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at     TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  UNIQUE (tenant_id, institution_id, subject_id, grade_id)
);
CREATE INDEX IF NOT EXISTS institution_subjects_tenant_institution_grade_idx
  ON institution_subjects (tenant_id, institution_id, grade_id);

-- enrollments.class_id (001) can now reference classes.
DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint WHERE conname = 'enrollments_class_id_fkey'
  ) THEN
    ALTER TABLE enrollments
      ADD CONSTRAINT enrollments_class_id_fkey FOREIGN KEY (class_id) REFERENCES classes(id);
  END IF;
END $$;

DO $$
DECLARE
  t TEXT;
BEGIN
  FOREACH t IN ARRAY ARRAY['classes', 'subjects', 'institution_subjects']
  LOOP
    EXECUTE format('ALTER TABLE %I ENABLE ROW LEVEL SECURITY', t);
    EXECUTE format('ALTER TABLE %I FORCE ROW LEVEL SECURITY', t);
    EXECUTE format('DROP POLICY IF EXISTS tenant_isolation ON %I', t);
    EXECUTE format(
      'CREATE POLICY tenant_isolation ON %I FOR ALL
         USING (tenant_id::text = NULLIF(current_setting(''app.tenant_id'', true), '''')
                OR current_setting(''app.platform_admin'', true) = ''1'')
         WITH CHECK (tenant_id::text = NULLIF(current_setting(''app.tenant_id'', true), '''')
                OR current_setting(''app.platform_admin'', true) = ''1'')',
      t
    );
  END LOOP;
END $$;

INSERT INTO schema_migrations (filename)
VALUES ('029_academics_classes_subjects_schema.sql')
ON CONFLICT (filename) DO NOTHING;
