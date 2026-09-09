-- LMS depth (Wave 9 / G-915): question bank, rubrics, submission files,
-- discussions, content library. Extends 026_lms_schema.sql.
-- Raw SQL — applied after 026 via tools/scripts/apply-sql.sh / ensureLmsSchema.
--
-- RLS: tenant bound via withPgTenant / app.tenant_id (same policy shape as 026/030).

-- ---------------------------------------------------------------------------
-- Extend quiz questions so a quiz can mix bank types (MCQ stays default).
-- ---------------------------------------------------------------------------
ALTER TABLE lms_quiz_questions
  ADD COLUMN IF NOT EXISTS question_type TEXT NOT NULL DEFAULT 'mcq';
ALTER TABLE lms_quiz_questions
  ADD COLUMN IF NOT EXISTS bank_item_id UUID;
ALTER TABLE lms_quiz_questions
  ADD COLUMN IF NOT EXISTS payload JSONB NOT NULL DEFAULT '{}'::jsonb;
ALTER TABLE lms_quiz_questions
  ALTER COLUMN correct_option_index DROP NOT NULL;

ALTER TABLE lms_quiz_questions DROP CONSTRAINT IF EXISTS lms_quiz_questions_question_type_check;
ALTER TABLE lms_quiz_questions
  ADD CONSTRAINT lms_quiz_questions_question_type_check
  CHECK (question_type IN ('mcq', 'msq', 'numeric', 'match', 'essay'));

ALTER TABLE lms_assignments
  ADD COLUMN IF NOT EXISTS rubric_id UUID;

-- ---------------------------------------------------------------------------
-- Question bank items (tenant × subject × grade × tags × skill)
-- ---------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS lms_question_bank_items (
  id UUID PRIMARY KEY,
  tenant_id UUID NOT NULL,
  scope TEXT NOT NULL CHECK (scope IN ('board', 'school')),
  board_id UUID,
  institution_id UUID,
  subject TEXT NOT NULL,
  grade_level TEXT,
  tags JSONB NOT NULL DEFAULT '[]'::jsonb,
  question_type TEXT NOT NULL
    CHECK (question_type IN ('mcq', 'msq', 'numeric', 'match', 'essay')),
  difficulty TEXT NOT NULL DEFAULT 'medium'
    CHECK (difficulty IN ('easy', 'medium', 'hard')),
  prompt TEXT NOT NULL,
  payload JSONB NOT NULL DEFAULT '{}'::jsonb,
  points NUMERIC NOT NULL DEFAULT 1 CHECK (points > 0),
  skill_id UUID,
  rubric_id UUID,
  created_by UUID,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  CONSTRAINT lms_question_bank_items_scope_target CHECK (
    (scope = 'board' AND board_id IS NOT NULL) OR
    (scope = 'school' AND institution_id IS NOT NULL)
  )
);
CREATE INDEX IF NOT EXISTS lms_question_bank_items_tenant_scope_idx
  ON lms_question_bank_items (tenant_id, scope, board_id, institution_id);
CREATE INDEX IF NOT EXISTS lms_question_bank_items_tenant_type_idx
  ON lms_question_bank_items (tenant_id, question_type, subject);

-- ---------------------------------------------------------------------------
-- Rubrics (criteria × levels) and per-submission grades
-- ---------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS lms_rubrics (
  id UUID PRIMARY KEY,
  tenant_id UUID NOT NULL,
  scope TEXT NOT NULL CHECK (scope IN ('board', 'school')),
  board_id UUID,
  institution_id UUID,
  name TEXT NOT NULL,
  subject TEXT,
  grade_level TEXT,
  created_by UUID,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  CONSTRAINT lms_rubrics_scope_target CHECK (
    (scope = 'board' AND board_id IS NOT NULL) OR
    (scope = 'school' AND institution_id IS NOT NULL)
  )
);
CREATE INDEX IF NOT EXISTS lms_rubrics_tenant_scope_idx
  ON lms_rubrics (tenant_id, scope, board_id, institution_id);

CREATE TABLE IF NOT EXISTS lms_rubric_criteria (
  id UUID PRIMARY KEY,
  tenant_id UUID NOT NULL,
  rubric_id UUID NOT NULL REFERENCES lms_rubrics(id) ON DELETE CASCADE,
  position INTEGER NOT NULL CHECK (position >= 0),
  name TEXT NOT NULL,
  description TEXT,
  max_points NUMERIC NOT NULL CHECK (max_points > 0),
  levels JSONB NOT NULL DEFAULT '[]'::jsonb,
  UNIQUE (rubric_id, position)
);
CREATE INDEX IF NOT EXISTS lms_rubric_criteria_tenant_rubric_idx
  ON lms_rubric_criteria (tenant_id, rubric_id);

CREATE TABLE IF NOT EXISTS lms_rubric_grades (
  id UUID PRIMARY KEY,
  tenant_id UUID NOT NULL,
  submission_id UUID NOT NULL REFERENCES lms_submissions(id) ON DELETE CASCADE,
  criterion_id UUID NOT NULL REFERENCES lms_rubric_criteria(id) ON DELETE CASCADE,
  question_id UUID,
  level_index INTEGER NOT NULL CHECK (level_index >= 0),
  points NUMERIC NOT NULL CHECK (points >= 0),
  comment TEXT,
  scored_by UUID,
  scored_at TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS lms_rubric_grades_tenant_submission_idx
  ON lms_rubric_grades (tenant_id, submission_id);

-- ---------------------------------------------------------------------------
-- Submission / assignment file metadata (bytes live in @proctira/storage or disk)
-- ---------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS lms_submission_files (
  id UUID PRIMARY KEY,
  tenant_id UUID NOT NULL,
  assignment_id UUID NOT NULL REFERENCES lms_assignments(id) ON DELETE CASCADE,
  submission_id UUID REFERENCES lms_submissions(id) ON DELETE CASCADE,
  filename TEXT NOT NULL,
  mime_type TEXT NOT NULL,
  byte_size INTEGER NOT NULL CHECK (byte_size > 0 AND byte_size <= 10485760),
  object_key TEXT NOT NULL,
  created_by UUID,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS lms_submission_files_tenant_assignment_idx
  ON lms_submission_files (tenant_id, assignment_id, submission_id);

-- ---------------------------------------------------------------------------
-- Discussions (teacher hide / lock)
-- ---------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS lms_discussion_threads (
  id UUID PRIMARY KEY,
  tenant_id UUID NOT NULL,
  institution_id UUID,
  class_key TEXT NOT NULL,
  title TEXT NOT NULL,
  locked BOOLEAN NOT NULL DEFAULT false,
  created_by UUID,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS lms_discussion_threads_tenant_class_idx
  ON lms_discussion_threads (tenant_id, class_key);

CREATE TABLE IF NOT EXISTS lms_discussion_posts (
  id UUID PRIMARY KEY,
  tenant_id UUID NOT NULL,
  thread_id UUID NOT NULL REFERENCES lms_discussion_threads(id) ON DELETE CASCADE,
  parent_id UUID,
  body TEXT NOT NULL,
  hidden BOOLEAN NOT NULL DEFAULT false,
  pinned BOOLEAN NOT NULL DEFAULT false,
  created_by UUID,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS lms_discussion_posts_tenant_thread_idx
  ON lms_discussion_posts (tenant_id, thread_id, created_at);

-- ---------------------------------------------------------------------------
-- Content library (student read-only when published)
-- ---------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS lms_content_items (
  id UUID PRIMARY KEY,
  tenant_id UUID NOT NULL,
  scope TEXT NOT NULL CHECK (scope IN ('board', 'school')),
  board_id UUID,
  institution_id UUID,
  title TEXT NOT NULL,
  kind TEXT NOT NULL CHECK (kind IN ('link', 'file', 'text')),
  body TEXT,
  tags JSONB NOT NULL DEFAULT '[]'::jsonb,
  class_key TEXT,
  subject TEXT,
  object_key TEXT,
  mime_type TEXT,
  published BOOLEAN NOT NULL DEFAULT false,
  created_by UUID,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  CONSTRAINT lms_content_items_scope_target CHECK (
    (scope = 'board' AND board_id IS NOT NULL) OR
    (scope = 'school' AND institution_id IS NOT NULL)
  )
);
CREATE INDEX IF NOT EXISTS lms_content_items_tenant_scope_idx
  ON lms_content_items (tenant_id, scope, published, subject, class_key);

CREATE TABLE IF NOT EXISTS lms_lessons (
  id UUID PRIMARY KEY,
  tenant_id UUID NOT NULL,
  scope TEXT NOT NULL CHECK (scope IN ('board', 'school')),
  board_id UUID,
  institution_id UUID,
  title TEXT NOT NULL,
  subject TEXT,
  grade_level TEXT,
  description TEXT,
  published BOOLEAN NOT NULL DEFAULT false,
  created_by UUID,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  CONSTRAINT lms_lessons_scope_target CHECK (
    (scope = 'board' AND board_id IS NOT NULL) OR
    (scope = 'school' AND institution_id IS NOT NULL)
  )
);
CREATE INDEX IF NOT EXISTS lms_lessons_tenant_scope_idx
  ON lms_lessons (tenant_id, scope, published, subject);

CREATE TABLE IF NOT EXISTS lms_lesson_resources (
  id UUID PRIMARY KEY,
  tenant_id UUID NOT NULL,
  lesson_id UUID NOT NULL REFERENCES lms_lessons(id) ON DELETE CASCADE,
  kind TEXT NOT NULL CHECK (kind IN ('link', 'file', 'video')),
  title TEXT NOT NULL,
  url TEXT,
  storage_key TEXT,
  mime_type TEXT,
  position INTEGER NOT NULL CHECK (position >= 0),
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS lms_lesson_resources_tenant_lesson_idx
  ON lms_lesson_resources (tenant_id, lesson_id, position);

-- ---------------------------------------------------------------------------
-- RLS (same policy shape as 026/030; tenant bound via withPgTenant)
-- ---------------------------------------------------------------------------
ALTER TABLE lms_question_bank_items ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS tenant_isolation ON lms_question_bank_items;
CREATE POLICY tenant_isolation ON lms_question_bank_items
  FOR ALL
  USING (tenant_id::text = NULLIF(current_setting('app.tenant_id', true), ''))
  WITH CHECK (tenant_id::text = NULLIF(current_setting('app.tenant_id', true), ''));
ALTER TABLE lms_question_bank_items FORCE ROW LEVEL SECURITY;

ALTER TABLE lms_rubrics ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS tenant_isolation ON lms_rubrics;
CREATE POLICY tenant_isolation ON lms_rubrics
  FOR ALL
  USING (tenant_id::text = NULLIF(current_setting('app.tenant_id', true), ''))
  WITH CHECK (tenant_id::text = NULLIF(current_setting('app.tenant_id', true), ''));
ALTER TABLE lms_rubrics FORCE ROW LEVEL SECURITY;

ALTER TABLE lms_rubric_criteria ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS tenant_isolation ON lms_rubric_criteria;
CREATE POLICY tenant_isolation ON lms_rubric_criteria
  FOR ALL
  USING (tenant_id::text = NULLIF(current_setting('app.tenant_id', true), ''))
  WITH CHECK (tenant_id::text = NULLIF(current_setting('app.tenant_id', true), ''));
ALTER TABLE lms_rubric_criteria FORCE ROW LEVEL SECURITY;

ALTER TABLE lms_rubric_grades ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS tenant_isolation ON lms_rubric_grades;
CREATE POLICY tenant_isolation ON lms_rubric_grades
  FOR ALL
  USING (tenant_id::text = NULLIF(current_setting('app.tenant_id', true), ''))
  WITH CHECK (tenant_id::text = NULLIF(current_setting('app.tenant_id', true), ''));
ALTER TABLE lms_rubric_grades FORCE ROW LEVEL SECURITY;

ALTER TABLE lms_submission_files ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS tenant_isolation ON lms_submission_files;
CREATE POLICY tenant_isolation ON lms_submission_files
  FOR ALL
  USING (tenant_id::text = NULLIF(current_setting('app.tenant_id', true), ''))
  WITH CHECK (tenant_id::text = NULLIF(current_setting('app.tenant_id', true), ''));
ALTER TABLE lms_submission_files FORCE ROW LEVEL SECURITY;

ALTER TABLE lms_discussion_threads ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS tenant_isolation ON lms_discussion_threads;
CREATE POLICY tenant_isolation ON lms_discussion_threads
  FOR ALL
  USING (tenant_id::text = NULLIF(current_setting('app.tenant_id', true), ''))
  WITH CHECK (tenant_id::text = NULLIF(current_setting('app.tenant_id', true), ''));
ALTER TABLE lms_discussion_threads FORCE ROW LEVEL SECURITY;

ALTER TABLE lms_discussion_posts ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS tenant_isolation ON lms_discussion_posts;
CREATE POLICY tenant_isolation ON lms_discussion_posts
  FOR ALL
  USING (tenant_id::text = NULLIF(current_setting('app.tenant_id', true), ''))
  WITH CHECK (tenant_id::text = NULLIF(current_setting('app.tenant_id', true), ''));
ALTER TABLE lms_discussion_posts FORCE ROW LEVEL SECURITY;

ALTER TABLE lms_content_items ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS tenant_isolation ON lms_content_items;
CREATE POLICY tenant_isolation ON lms_content_items
  FOR ALL
  USING (tenant_id::text = NULLIF(current_setting('app.tenant_id', true), ''))
  WITH CHECK (tenant_id::text = NULLIF(current_setting('app.tenant_id', true), ''));
ALTER TABLE lms_content_items FORCE ROW LEVEL SECURITY;

ALTER TABLE lms_lessons ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS tenant_isolation ON lms_lessons;
CREATE POLICY tenant_isolation ON lms_lessons
  FOR ALL
  USING (tenant_id::text = NULLIF(current_setting('app.tenant_id', true), ''))
  WITH CHECK (tenant_id::text = NULLIF(current_setting('app.tenant_id', true), ''));
ALTER TABLE lms_lessons FORCE ROW LEVEL SECURITY;

ALTER TABLE lms_lesson_resources ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS tenant_isolation ON lms_lesson_resources;
CREATE POLICY tenant_isolation ON lms_lesson_resources
  FOR ALL
  USING (tenant_id::text = NULLIF(current_setting('app.tenant_id', true), ''))
  WITH CHECK (tenant_id::text = NULLIF(current_setting('app.tenant_id', true), ''));
ALTER TABLE lms_lesson_resources FORCE ROW LEVEL SECURITY;
