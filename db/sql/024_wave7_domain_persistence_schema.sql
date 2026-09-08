-- 024_wave7_domain_persistence_schema.sql
-- G-717: durable storage for surfaces that were memory-only.
--
--   1. HR appraisals (templates + appraisals) and training (programs, sessions,
--      attendance, certifications) — routes were unregistered because no store
--      existed.
--   2. Assessment report cards (templates, teacher comments, institution
--      branding, generation jobs).
--   3. RLS for the admissions CRM tables from 014 (waitlist, interview slots,
--      bookings) which shipped without tenant policies.
--
-- Every table: tenant_id, RLS (ENABLE + FORCE), tenant_isolation policy keyed on
-- app.tenant_id (platform admin bypass), updated_at trigger where applicable.

CREATE EXTENSION IF NOT EXISTS "uuid-ossp";

CREATE OR REPLACE FUNCTION proctira_set_updated_at()
RETURNS TRIGGER AS $$
BEGIN
  NEW.updated_at = NOW();
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

-- ---------------------------------------------------------------------------
-- 1. HR appraisals
-- ---------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS hr_appraisal_templates (
  id                 UUID PRIMARY KEY,
  tenant_id          UUID NOT NULL,
  name               TEXT NOT NULL,
  description        TEXT,
  academic_period_id UUID NOT NULL,
  criteria           JSONB NOT NULL DEFAULT '[]'::jsonb,
  score_min          NUMERIC(10,2) NOT NULL DEFAULT 0,
  score_max          NUMERIC(10,2) NOT NULL DEFAULT 100,
  created_at         TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at         TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  CHECK (score_max > score_min)
);
CREATE INDEX IF NOT EXISTS hr_appraisal_templates_tenant_idx
  ON hr_appraisal_templates (tenant_id, created_at DESC);

CREATE TABLE IF NOT EXISTS hr_appraisals (
  id                   UUID PRIMARY KEY,
  tenant_id            UUID NOT NULL,
  staff_id             UUID NOT NULL,
  template_id          UUID NOT NULL REFERENCES hr_appraisal_templates(id) ON DELETE RESTRICT,
  appraisal_date       DATE NOT NULL,
  scores               JSONB NOT NULL DEFAULT '[]'::jsonb,
  total_score          NUMERIC(10,2) NOT NULL DEFAULT 0,
  overall_comment      TEXT,
  status               TEXT NOT NULL DEFAULT 'DRAFT'
                       CHECK (status IN ('DRAFT','SUBMITTED','IN_REVIEW','APPROVED','REJECTED')),
  workflow_instance_id TEXT,
  created_at           TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at           TIMESTAMPTZ NOT NULL DEFAULT NOW()
);
CREATE INDEX IF NOT EXISTS hr_appraisals_tenant_staff_idx
  ON hr_appraisals (tenant_id, staff_id, appraisal_date DESC);
CREATE INDEX IF NOT EXISTS hr_appraisals_tenant_status_idx
  ON hr_appraisals (tenant_id, status);

-- ---------------------------------------------------------------------------
-- 1b. HR training
-- ---------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS hr_training_programs (
  id                          UUID PRIMARY KEY,
  tenant_id                   UUID NOT NULL,
  name                        TEXT NOT NULL,
  description                 TEXT,
  start_date                  DATE NOT NULL,
  end_date                    DATE NOT NULL,
  provider                    TEXT,
  certification_name          TEXT,
  certification_validity_days INTEGER CHECK (certification_validity_days IS NULL OR certification_validity_days > 0),
  created_at                  TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at                  TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  CHECK (end_date >= start_date)
);
CREATE INDEX IF NOT EXISTS hr_training_programs_tenant_idx
  ON hr_training_programs (tenant_id, start_date DESC);

CREATE TABLE IF NOT EXISTS hr_training_sessions (
  id              UUID PRIMARY KEY,
  tenant_id       UUID NOT NULL,
  program_id      UUID NOT NULL REFERENCES hr_training_programs(id) ON DELETE CASCADE,
  title           TEXT NOT NULL,
  session_date    DATE NOT NULL,
  start_time      TEXT,
  end_time        TEXT,
  location        TEXT,
  instructor_name TEXT,
  created_at      TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at      TIMESTAMPTZ NOT NULL DEFAULT NOW()
);
CREATE INDEX IF NOT EXISTS hr_training_sessions_program_idx
  ON hr_training_sessions (tenant_id, program_id, session_date);

CREATE TABLE IF NOT EXISTS hr_training_attendance (
  id         UUID PRIMARY KEY,
  tenant_id  UUID NOT NULL,
  session_id UUID NOT NULL REFERENCES hr_training_sessions(id) ON DELETE CASCADE,
  staff_id   UUID NOT NULL,
  status     TEXT NOT NULL CHECK (status IN ('PRESENT','ABSENT','EXCUSED')),
  comment    TEXT,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  UNIQUE (tenant_id, session_id, staff_id)
);
CREATE INDEX IF NOT EXISTS hr_training_attendance_staff_idx
  ON hr_training_attendance (tenant_id, staff_id);

CREATE TABLE IF NOT EXISTS hr_certifications (
  id                 UUID PRIMARY KEY,
  tenant_id          UUID NOT NULL,
  staff_id           UUID NOT NULL,
  program_id         UUID NOT NULL REFERENCES hr_training_programs(id) ON DELETE RESTRICT,
  certification_name TEXT NOT NULL,
  issued_date        DATE NOT NULL,
  expiry_date        DATE,
  status             TEXT NOT NULL DEFAULT 'ACTIVE' CHECK (status IN ('ACTIVE','EXPIRED','REVOKED')),
  created_at         TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at         TIMESTAMPTZ NOT NULL DEFAULT NOW()
);
CREATE INDEX IF NOT EXISTS hr_certifications_staff_idx
  ON hr_certifications (tenant_id, staff_id, status);
CREATE INDEX IF NOT EXISTS hr_certifications_expiry_idx
  ON hr_certifications (tenant_id, expiry_date) WHERE status = 'ACTIVE';

-- ---------------------------------------------------------------------------
-- 2. Assessment report cards
-- ---------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS report_card_templates (
  id                    UUID PRIMARY KEY,
  tenant_id             UUID NOT NULL,
  name                  TEXT NOT NULL,
  template_content      TEXT NOT NULL,
  is_default            BOOLEAN NOT NULL DEFAULT FALSE,
  include_logo          BOOLEAN NOT NULL DEFAULT TRUE,
  include_grade_summary BOOLEAN NOT NULL DEFAULT TRUE,
  include_comments      BOOLEAN NOT NULL DEFAULT TRUE,
  created_at            TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at            TIMESTAMPTZ NOT NULL DEFAULT NOW()
);
-- At most one default template per tenant.
CREATE UNIQUE INDEX IF NOT EXISTS report_card_templates_default_uq
  ON report_card_templates (tenant_id) WHERE is_default;

CREATE TABLE IF NOT EXISTS report_card_teacher_comments (
  id                 UUID PRIMARY KEY,
  tenant_id          UUID NOT NULL,
  student_id         UUID NOT NULL,
  subject_id         UUID NOT NULL,
  academic_period_id UUID NOT NULL,
  teacher_id         UUID NOT NULL,
  comment            TEXT NOT NULL CHECK (char_length(comment) <= 500),
  created_at         TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at         TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  UNIQUE (tenant_id, student_id, subject_id, academic_period_id)
);

CREATE TABLE IF NOT EXISTS report_card_institution_branding (
  institution_id UUID NOT NULL,
  tenant_id      UUID NOT NULL,
  name           TEXT NOT NULL,
  logo_url       TEXT,
  address        TEXT,
  contact_phone  TEXT,
  contact_email  TEXT,
  created_at     TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at     TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  PRIMARY KEY (tenant_id, institution_id)
);

CREATE TABLE IF NOT EXISTS report_card_jobs (
  id                 UUID PRIMARY KEY,
  tenant_id          UUID NOT NULL,
  student_id         UUID NOT NULL,
  academic_period_id UUID NOT NULL,
  template_id        UUID NOT NULL REFERENCES report_card_templates(id) ON DELETE RESTRICT,
  institution_id     UUID NOT NULL,
  status             TEXT NOT NULL DEFAULT 'queued'
                     CHECK (status IN ('queued','processing','completed','failed')),
  error_message      TEXT,
  output_url         TEXT,
  created_at         TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at         TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  completed_at       TIMESTAMPTZ
);
CREATE INDEX IF NOT EXISTS report_card_jobs_student_period_idx
  ON report_card_jobs (tenant_id, student_id, academic_period_id, created_at DESC);

-- ---------------------------------------------------------------------------
-- 3. RLS + updated_at triggers
-- ---------------------------------------------------------------------------
DO $$
DECLARE
  t TEXT;
BEGIN
  FOREACH t IN ARRAY ARRAY[
    'hr_appraisal_templates', 'hr_appraisals',
    'hr_training_programs', 'hr_training_sessions', 'hr_training_attendance', 'hr_certifications',
    'report_card_templates', 'report_card_teacher_comments',
    'report_card_institution_branding', 'report_card_jobs',
    'admission_waitlist_entries', 'admission_interview_slots', 'admission_interview_bookings'
  ]
  LOOP
    IF to_regclass(t) IS NOT NULL THEN
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
    END IF;
  END LOOP;

  FOREACH t IN ARRAY ARRAY[
    'hr_appraisal_templates', 'hr_appraisals',
    'hr_training_programs', 'hr_training_sessions', 'hr_certifications',
    'report_card_templates', 'report_card_teacher_comments',
    'report_card_institution_branding', 'report_card_jobs'
  ]
  LOOP
    IF to_regclass(t) IS NOT NULL THEN
      EXECUTE format('DROP TRIGGER IF EXISTS trg_%s_updated_at ON %I', t, t);
      EXECUTE format(
        'CREATE TRIGGER trg_%s_updated_at BEFORE UPDATE ON %I
           FOR EACH ROW EXECUTE FUNCTION proctira_set_updated_at()',
        t, t
      );
    END IF;
  END LOOP;
END $$;
