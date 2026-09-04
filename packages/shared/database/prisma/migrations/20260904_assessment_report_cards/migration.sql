-- Assessment report-card tables (charter §19 / Phase 6 residual).
-- Bare UUID tenant/cross-domain ids (no cross-schema FKs).

CREATE SCHEMA IF NOT EXISTS assessment;
CREATE EXTENSION IF NOT EXISTS "uuid-ossp";

CREATE TABLE IF NOT EXISTS assessment.report_card_templates (
  id UUID PRIMARY KEY,
  tenant_id UUID NOT NULL,
  name VARCHAR(255) NOT NULL,
  template_content TEXT NOT NULL,
  is_default BOOLEAN NOT NULL DEFAULT FALSE,
  include_logo BOOLEAN NOT NULL DEFAULT TRUE,
  include_grade_summary BOOLEAN NOT NULL DEFAULT TRUE,
  include_comments BOOLEAN NOT NULL DEFAULT TRUE,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);
CREATE INDEX IF NOT EXISTS report_card_templates_tenant_id_is_default_idx
  ON assessment.report_card_templates (tenant_id, is_default);

CREATE TABLE IF NOT EXISTS assessment.teacher_comments (
  id UUID PRIMARY KEY,
  tenant_id UUID NOT NULL,
  student_id UUID NOT NULL,
  subject_id UUID NOT NULL,
  academic_period_id UUID NOT NULL,
  teacher_id UUID NOT NULL,
  comment VARCHAR(500) NOT NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);
CREATE UNIQUE INDEX IF NOT EXISTS teacher_comments_tenant_student_subject_period_key
  ON assessment.teacher_comments (tenant_id, student_id, subject_id, academic_period_id);
CREATE INDEX IF NOT EXISTS teacher_comments_tenant_student_period_idx
  ON assessment.teacher_comments (tenant_id, student_id, academic_period_id);

CREATE TABLE IF NOT EXISTS assessment.institution_brandings (
  tenant_id UUID NOT NULL,
  institution_id UUID NOT NULL,
  name VARCHAR(255) NOT NULL,
  logo_url TEXT,
  address TEXT,
  contact_phone VARCHAR(50),
  contact_email VARCHAR(255),
  PRIMARY KEY (tenant_id, institution_id)
);

CREATE TABLE IF NOT EXISTS assessment.report_card_jobs (
  id UUID PRIMARY KEY,
  tenant_id UUID NOT NULL,
  student_id UUID NOT NULL,
  academic_period_id UUID NOT NULL,
  template_id UUID NOT NULL,
  institution_id UUID NOT NULL,
  status VARCHAR(20) NOT NULL DEFAULT 'queued',
  error_message TEXT,
  output_url TEXT,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  completed_at TIMESTAMPTZ
);
CREATE INDEX IF NOT EXISTS report_card_jobs_tenant_student_period_idx
  ON assessment.report_card_jobs (tenant_id, student_id, academic_period_id);
CREATE INDEX IF NOT EXISTS report_card_jobs_tenant_id_status_idx
  ON assessment.report_card_jobs (tenant_id, status);
