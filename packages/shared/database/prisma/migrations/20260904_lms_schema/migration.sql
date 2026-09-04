-- Phase 26: LMS
CREATE SCHEMA IF NOT EXISTS lms;
CREATE EXTENSION IF NOT EXISTS "uuid-ossp";

CREATE TABLE IF NOT EXISTS lms.courses (
  id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  tenant_id UUID NOT NULL,
  institution_id UUID NOT NULL,
  class_id UUID,
  subject_id UUID,
  staff_id UUID,
  title VARCHAR(255) NOT NULL,
  status VARCHAR(255) NOT NULL DEFAULT 'draft',
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);
CREATE INDEX IF NOT EXISTS courses_tenant_id_idx ON lms.courses (tenant_id);

CREATE TABLE IF NOT EXISTS lms.lessons (
  id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  tenant_id UUID NOT NULL,
  course_id UUID NOT NULL,
  title VARCHAR(255) NOT NULL,
  content_ref TEXT,
  lesson_order DOUBLE PRECISION NOT NULL DEFAULT 1,
  status VARCHAR(255) NOT NULL DEFAULT 'published',
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);
CREATE INDEX IF NOT EXISTS lessons_tenant_id_idx ON lms.lessons (tenant_id);

CREATE TABLE IF NOT EXISTS lms.enrollments (
  id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  tenant_id UUID NOT NULL,
  course_id UUID NOT NULL,
  student_id UUID NOT NULL,
  status VARCHAR(255) NOT NULL DEFAULT 'active',
  progress_pct DOUBLE PRECISION NOT NULL DEFAULT 0,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);
CREATE INDEX IF NOT EXISTS enrollments_tenant_id_idx ON lms.enrollments (tenant_id);

