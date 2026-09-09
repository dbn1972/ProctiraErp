-- Curriculum: syllabus units, lesson plans, learning outcomes, coverage (Wave 9 / G-923).
-- Raw SQL — applied after 032 via tools/scripts/apply-sql.sh.
-- RLS: tenant bound via withPgTenant / app.tenant_id; FORCE ROW LEVEL SECURITY.

CREATE TABLE IF NOT EXISTS syllabus_units (
  id UUID PRIMARY KEY,
  tenant_id UUID NOT NULL,
  institution_id UUID,
  subject_id UUID NOT NULL,
  grade_id UUID NOT NULL,
  academic_period_id UUID NOT NULL,
  code TEXT NOT NULL,
  name TEXT NOT NULL,
  sequence INTEGER NOT NULL DEFAULT 1,
  planned BOOLEAN NOT NULL DEFAULT TRUE,
  notes TEXT,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  UNIQUE (tenant_id, subject_id, grade_id, academic_period_id, code)
);
CREATE INDEX IF NOT EXISTS syllabus_units_scope_idx
  ON syllabus_units (tenant_id, subject_id, grade_id, academic_period_id);

CREATE TABLE IF NOT EXISTS lesson_plans (
  id UUID PRIMARY KEY,
  tenant_id UUID NOT NULL,
  unit_id UUID NOT NULL REFERENCES syllabus_units(id) ON DELETE CASCADE,
  title TEXT NOT NULL,
  objectives TEXT,
  planned_date DATE,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS lesson_plans_unit_idx
  ON lesson_plans (tenant_id, unit_id);

CREATE TABLE IF NOT EXISTS learning_outcomes (
  id UUID PRIMARY KEY,
  tenant_id UUID NOT NULL,
  unit_id UUID REFERENCES syllabus_units(id) ON DELETE SET NULL,
  subject_id UUID NOT NULL,
  grade_id UUID,
  code TEXT NOT NULL,
  statement TEXT NOT NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS learning_outcomes_subject_idx
  ON learning_outcomes (tenant_id, subject_id, grade_id);

CREATE TABLE IF NOT EXISTS unit_coverage (
  id UUID PRIMARY KEY,
  tenant_id UUID NOT NULL,
  unit_id UUID NOT NULL REFERENCES syllabus_units(id) ON DELETE CASCADE,
  taught_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  taught_by TEXT,
  timetable_meeting_id UUID,
  lms_skill_id UUID,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  UNIQUE (tenant_id, unit_id)
);
CREATE INDEX IF NOT EXISTS unit_coverage_unit_idx
  ON unit_coverage (tenant_id, unit_id);

-- ---------------------------------------------------------------------------
-- RLS (same policy shape as 030; tenant bound via withPgTenant / app.tenant_id)
-- ---------------------------------------------------------------------------
ALTER TABLE syllabus_units ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS tenant_isolation ON syllabus_units;
CREATE POLICY tenant_isolation ON syllabus_units
  FOR ALL
  USING (tenant_id::text = NULLIF(current_setting('app.tenant_id', true), ''))
  WITH CHECK (tenant_id::text = NULLIF(current_setting('app.tenant_id', true), ''));
ALTER TABLE syllabus_units FORCE ROW LEVEL SECURITY;

ALTER TABLE lesson_plans ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS tenant_isolation ON lesson_plans;
CREATE POLICY tenant_isolation ON lesson_plans
  FOR ALL
  USING (tenant_id::text = NULLIF(current_setting('app.tenant_id', true), ''))
  WITH CHECK (tenant_id::text = NULLIF(current_setting('app.tenant_id', true), ''));
ALTER TABLE lesson_plans FORCE ROW LEVEL SECURITY;

ALTER TABLE learning_outcomes ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS tenant_isolation ON learning_outcomes;
CREATE POLICY tenant_isolation ON learning_outcomes
  FOR ALL
  USING (tenant_id::text = NULLIF(current_setting('app.tenant_id', true), ''))
  WITH CHECK (tenant_id::text = NULLIF(current_setting('app.tenant_id', true), ''));
ALTER TABLE learning_outcomes FORCE ROW LEVEL SECURITY;

ALTER TABLE unit_coverage ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS tenant_isolation ON unit_coverage;
CREATE POLICY tenant_isolation ON unit_coverage
  FOR ALL
  USING (tenant_id::text = NULLIF(current_setting('app.tenant_id', true), ''))
  WITH CHECK (tenant_id::text = NULLIF(current_setting('app.tenant_id', true), ''));
ALTER TABLE unit_coverage FORCE ROW LEVEL SECURITY;
