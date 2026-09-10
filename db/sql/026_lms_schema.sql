-- LMS domain (Wave 8 / G-801, G-802): assignments, homework, quizzes, submissions
-- and the Spiral PAL (Personalised Adaptive Learning) mastery ledger.
-- Raw SQL — no Prisma. Applied after 025 via tools/scripts/apply-sql.sh.
--
-- Tenancy model (see docs/architecture/TENANCY_BOARD_SCHOOL.md):
--   tenant (RLS boundary) → boards → institutions (schools).
--   Every LMS row carries `scope`:
--     'board'  → shared with every school under `board_id`
--     'school' → visible only to `institution_id`
--   RLS policies are included here (tables created after 015); 021 applies
--   FORCE ROW LEVEL SECURITY to every RLS-enabled table.

CREATE TABLE IF NOT EXISTS lms_skills (
  id UUID PRIMARY KEY,
  tenant_id UUID NOT NULL,
  scope TEXT NOT NULL CHECK (scope IN ('board', 'school')),
  board_id UUID,
  institution_id UUID,
  code TEXT NOT NULL,
  name TEXT NOT NULL,
  subject TEXT NOT NULL,
  grade_level TEXT,
  description TEXT,
  prerequisite_skill_ids JSONB NOT NULL DEFAULT '[]'::jsonb,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  CONSTRAINT lms_skills_scope_target CHECK (
    (scope = 'board' AND board_id IS NOT NULL) OR
    (scope = 'school' AND institution_id IS NOT NULL)
  ),
  UNIQUE (tenant_id, code)
);
CREATE INDEX IF NOT EXISTS lms_skills_tenant_scope_idx
  ON lms_skills (tenant_id, scope, board_id, institution_id);

CREATE TABLE IF NOT EXISTS lms_assignments (
  id UUID PRIMARY KEY,
  tenant_id UUID NOT NULL,
  scope TEXT NOT NULL CHECK (scope IN ('board', 'school')),
  board_id UUID,
  institution_id UUID,
  kind TEXT NOT NULL CHECK (kind IN ('assignment', 'homework', 'quiz')),
  title TEXT NOT NULL,
  description TEXT,
  subject TEXT NOT NULL,
  grade_level TEXT,
  section_id UUID,
  skill_ids JSONB NOT NULL DEFAULT '[]'::jsonb,
  max_score NUMERIC NOT NULL DEFAULT 100 CHECK (max_score > 0),
  due_at TIMESTAMPTZ,
  time_limit_minutes INTEGER CHECK (time_limit_minutes IS NULL OR time_limit_minutes > 0),
  allow_late BOOLEAN NOT NULL DEFAULT true,
  status TEXT NOT NULL DEFAULT 'draft'
    CHECK (status IN ('draft', 'published', 'closed', 'archived')),
  created_by UUID,
  published_at TIMESTAMPTZ,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  CONSTRAINT lms_assignments_scope_target CHECK (
    (scope = 'board' AND board_id IS NOT NULL) OR
    (scope = 'school' AND institution_id IS NOT NULL)
  )
);
CREATE INDEX IF NOT EXISTS lms_assignments_tenant_scope_idx
  ON lms_assignments (tenant_id, scope, board_id, institution_id);
CREATE INDEX IF NOT EXISTS lms_assignments_tenant_kind_status_idx
  ON lms_assignments (tenant_id, kind, status);
CREATE INDEX IF NOT EXISTS lms_assignments_tenant_due_idx
  ON lms_assignments (tenant_id, due_at);

CREATE TABLE IF NOT EXISTS lms_quiz_questions (
  id UUID PRIMARY KEY,
  tenant_id UUID NOT NULL,
  assignment_id UUID NOT NULL REFERENCES lms_assignments(id) ON DELETE CASCADE,
  position INTEGER NOT NULL CHECK (position >= 0),
  prompt TEXT NOT NULL,
  options JSONB NOT NULL DEFAULT '[]'::jsonb,
  correct_option_index INTEGER NOT NULL CHECK (correct_option_index >= 0),
  points NUMERIC NOT NULL DEFAULT 1 CHECK (points > 0),
  skill_id UUID,
  explanation TEXT,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  UNIQUE (assignment_id, position)
);
CREATE INDEX IF NOT EXISTS lms_quiz_questions_tenant_assignment_idx
  ON lms_quiz_questions (tenant_id, assignment_id);

CREATE TABLE IF NOT EXISTS lms_submissions (
  id UUID PRIMARY KEY,
  tenant_id UUID NOT NULL,
  assignment_id UUID NOT NULL REFERENCES lms_assignments(id) ON DELETE CASCADE,
  student_id UUID NOT NULL,
  institution_id UUID,
  status TEXT NOT NULL DEFAULT 'submitted'
    CHECK (status IN ('submitted', 'late', 'graded', 'returned')),
  content TEXT,
  attachments JSONB NOT NULL DEFAULT '[]'::jsonb,
  answers JSONB NOT NULL DEFAULT '[]'::jsonb,
  score NUMERIC CHECK (score IS NULL OR score >= 0),
  auto_graded BOOLEAN NOT NULL DEFAULT false,
  feedback TEXT,
  submitted_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  graded_at TIMESTAMPTZ,
  graded_by UUID,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  UNIQUE (tenant_id, assignment_id, student_id)
);
CREATE INDEX IF NOT EXISTS lms_submissions_tenant_student_idx
  ON lms_submissions (tenant_id, student_id);
CREATE INDEX IF NOT EXISTS lms_submissions_tenant_assignment_status_idx
  ON lms_submissions (tenant_id, assignment_id, status);

-- Spiral PAL ledger: one row per (student, skill). Interval grows on success
-- (1 → 3 → 7 → 14 → 30 → 60 days) and collapses on failure so the skill
-- spirals back into the learner's plan.
CREATE TABLE IF NOT EXISTS lms_skill_mastery (
  id UUID PRIMARY KEY,
  tenant_id UUID NOT NULL,
  student_id UUID NOT NULL,
  skill_id UUID NOT NULL REFERENCES lms_skills(id) ON DELETE CASCADE,
  institution_id UUID,
  mastery NUMERIC NOT NULL DEFAULT 0 CHECK (mastery >= 0 AND mastery <= 1),
  attempts INTEGER NOT NULL DEFAULT 0 CHECK (attempts >= 0),
  correct INTEGER NOT NULL DEFAULT 0 CHECK (correct >= 0),
  streak INTEGER NOT NULL DEFAULT 0 CHECK (streak >= 0),
  interval_days INTEGER NOT NULL DEFAULT 0 CHECK (interval_days >= 0),
  due_at TIMESTAMPTZ,
  last_reviewed_at TIMESTAMPTZ,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  UNIQUE (tenant_id, student_id, skill_id)
);
CREATE INDEX IF NOT EXISTS lms_skill_mastery_tenant_student_due_idx
  ON lms_skill_mastery (tenant_id, student_id, due_at);

CREATE TABLE IF NOT EXISTS lms_practice_attempts (
  id UUID PRIMARY KEY,
  tenant_id UUID NOT NULL,
  student_id UUID NOT NULL,
  skill_id UUID NOT NULL REFERENCES lms_skills(id) ON DELETE CASCADE,
  source TEXT NOT NULL DEFAULT 'practice'
    CHECK (source IN ('practice', 'quiz', 'homework', 'assignment')),
  source_id UUID,
  correct BOOLEAN NOT NULL,
  response_time_ms INTEGER CHECK (response_time_ms IS NULL OR response_time_ms >= 0),
  mastery_after NUMERIC NOT NULL CHECK (mastery_after >= 0 AND mastery_after <= 1),
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS lms_practice_attempts_tenant_student_idx
  ON lms_practice_attempts (tenant_id, student_id, created_at DESC);

-- ========================= RLS (G-103 / G-801) =========================
ALTER TABLE lms_skills ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS tenant_isolation ON lms_skills;
CREATE POLICY tenant_isolation ON lms_skills
  FOR ALL
  USING (tenant_id::text = NULLIF(current_setting('app.tenant_id', true), ''))
  WITH CHECK (tenant_id::text = NULLIF(current_setting('app.tenant_id', true), ''));

ALTER TABLE lms_assignments ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS tenant_isolation ON lms_assignments;
CREATE POLICY tenant_isolation ON lms_assignments
  FOR ALL
  USING (tenant_id::text = NULLIF(current_setting('app.tenant_id', true), ''))
  WITH CHECK (tenant_id::text = NULLIF(current_setting('app.tenant_id', true), ''));

ALTER TABLE lms_quiz_questions ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS tenant_isolation ON lms_quiz_questions;
CREATE POLICY tenant_isolation ON lms_quiz_questions
  FOR ALL
  USING (tenant_id::text = NULLIF(current_setting('app.tenant_id', true), ''))
  WITH CHECK (tenant_id::text = NULLIF(current_setting('app.tenant_id', true), ''));

ALTER TABLE lms_submissions ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS tenant_isolation ON lms_submissions;
CREATE POLICY tenant_isolation ON lms_submissions
  FOR ALL
  USING (tenant_id::text = NULLIF(current_setting('app.tenant_id', true), ''))
  WITH CHECK (tenant_id::text = NULLIF(current_setting('app.tenant_id', true), ''));

ALTER TABLE lms_skill_mastery ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS tenant_isolation ON lms_skill_mastery;
CREATE POLICY tenant_isolation ON lms_skill_mastery
  FOR ALL
  USING (tenant_id::text = NULLIF(current_setting('app.tenant_id', true), ''))
  WITH CHECK (tenant_id::text = NULLIF(current_setting('app.tenant_id', true), ''));

ALTER TABLE lms_practice_attempts ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS tenant_isolation ON lms_practice_attempts;
CREATE POLICY tenant_isolation ON lms_practice_attempts
  FOR ALL
  USING (tenant_id::text = NULLIF(current_setting('app.tenant_id', true), ''))
  WITH CHECK (tenant_id::text = NULLIF(current_setting('app.tenant_id', true), ''));

-- 021 already ran for pre-existing tables; force RLS for the new ones too so
-- the owning role cannot bypass tenant isolation.
ALTER TABLE lms_skills FORCE ROW LEVEL SECURITY;
ALTER TABLE lms_assignments FORCE ROW LEVEL SECURITY;
ALTER TABLE lms_quiz_questions FORCE ROW LEVEL SECURITY;
ALTER TABLE lms_submissions FORCE ROW LEVEL SECURITY;
ALTER TABLE lms_skill_mastery FORCE ROW LEVEL SECURITY;
ALTER TABLE lms_practice_attempts FORCE ROW LEVEL SECURITY;
