-- Staff appraisal + training tables (charter §19 / Phase 8 residual).
-- Bare UUID tenant/cross-domain ids (no cross-schema FKs).

CREATE SCHEMA IF NOT EXISTS staff;
CREATE EXTENSION IF NOT EXISTS "uuid-ossp";

CREATE TABLE IF NOT EXISTS staff.staff_appraisal_templates (
  id UUID PRIMARY KEY,
  tenant_id UUID NOT NULL,
  name VARCHAR(255) NOT NULL,
  description TEXT,
  academic_period_id UUID NOT NULL,
  criteria JSONB NOT NULL DEFAULT '[]'::jsonb,
  score_min DOUBLE PRECISION NOT NULL,
  score_max DOUBLE PRECISION NOT NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);
CREATE INDEX IF NOT EXISTS staff_appraisal_templates_tenant_id_idx
  ON staff.staff_appraisal_templates (tenant_id);

CREATE TABLE IF NOT EXISTS staff.staff_appraisals (
  id UUID PRIMARY KEY,
  tenant_id UUID NOT NULL,
  staff_id UUID NOT NULL,
  template_id UUID NOT NULL,
  appraisal_date VARCHAR(32) NOT NULL,
  scores JSONB NOT NULL DEFAULT '[]'::jsonb,
  total_score DOUBLE PRECISION NOT NULL,
  overall_comment TEXT,
  status VARCHAR(20) NOT NULL DEFAULT 'DRAFT',
  workflow_instance_id UUID,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);
CREATE INDEX IF NOT EXISTS staff_appraisals_tenant_id_staff_id_idx
  ON staff.staff_appraisals (tenant_id, staff_id);
CREATE INDEX IF NOT EXISTS staff_appraisals_tenant_id_template_id_idx
  ON staff.staff_appraisals (tenant_id, template_id);
CREATE INDEX IF NOT EXISTS staff_appraisals_tenant_id_status_idx
  ON staff.staff_appraisals (tenant_id, status);

CREATE TABLE IF NOT EXISTS staff.staff_training_programs (
  id UUID PRIMARY KEY,
  tenant_id UUID NOT NULL,
  name VARCHAR(255) NOT NULL,
  description TEXT,
  start_date VARCHAR(32) NOT NULL,
  end_date VARCHAR(32) NOT NULL,
  provider VARCHAR(255),
  certification_name VARCHAR(255),
  certification_validity_days INT,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);
CREATE INDEX IF NOT EXISTS staff_training_programs_tenant_id_name_idx
  ON staff.staff_training_programs (tenant_id, name);

CREATE TABLE IF NOT EXISTS staff.staff_training_sessions (
  id UUID PRIMARY KEY,
  tenant_id UUID NOT NULL,
  program_id UUID NOT NULL,
  title VARCHAR(255) NOT NULL,
  date VARCHAR(32) NOT NULL,
  start_time VARCHAR(16),
  end_time VARCHAR(16),
  location VARCHAR(255),
  instructor_name VARCHAR(255),
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);
CREATE INDEX IF NOT EXISTS staff_training_sessions_tenant_id_program_id_idx
  ON staff.staff_training_sessions (tenant_id, program_id);

CREATE TABLE IF NOT EXISTS staff.staff_training_attendance (
  id UUID PRIMARY KEY,
  tenant_id UUID NOT NULL,
  session_id UUID NOT NULL,
  staff_id UUID NOT NULL,
  status VARCHAR(20) NOT NULL,
  comment TEXT,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);
CREATE UNIQUE INDEX IF NOT EXISTS staff_training_attendance_tenant_session_staff_key
  ON staff.staff_training_attendance (tenant_id, session_id, staff_id);
CREATE INDEX IF NOT EXISTS staff_training_attendance_tenant_id_session_id_idx
  ON staff.staff_training_attendance (tenant_id, session_id);
CREATE INDEX IF NOT EXISTS staff_training_attendance_tenant_id_staff_id_idx
  ON staff.staff_training_attendance (tenant_id, staff_id);

CREATE TABLE IF NOT EXISTS staff.staff_certifications (
  id UUID PRIMARY KEY,
  tenant_id UUID NOT NULL,
  staff_id UUID NOT NULL,
  program_id UUID NOT NULL,
  certification_name VARCHAR(255) NOT NULL,
  issued_date VARCHAR(32) NOT NULL,
  expiry_date VARCHAR(32),
  status VARCHAR(20) NOT NULL DEFAULT 'ACTIVE',
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);
CREATE INDEX IF NOT EXISTS staff_certifications_tenant_id_staff_id_idx
  ON staff.staff_certifications (tenant_id, staff_id);
CREATE INDEX IF NOT EXISTS staff_certifications_tenant_id_status_idx
  ON staff.staff_certifications (tenant_id, status);
CREATE INDEX IF NOT EXISTS staff_certifications_tenant_id_program_id_idx
  ON staff.staff_certifications (tenant_id, program_id);
