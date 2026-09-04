-- Phase schema ownership: survey (charter §19)
-- CREATE SCHEMA + tables; bare UUID tenant/cross-domain ids (no cross-schema FKs).

CREATE SCHEMA IF NOT EXISTS survey;
CREATE EXTENSION IF NOT EXISTS "uuid-ossp";

CREATE TABLE IF NOT EXISTS survey.surveys (
  id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  tenant_id UUID NOT NULL,
  name VARCHAR(255) NOT NULL,
  description TEXT,
  status VARCHAR(30) NOT NULL,
  academic_period_id UUID,
  start_date VARCHAR(32),
  end_date VARCHAR(32),
  questions JSONB NOT NULL DEFAULT '[]'::jsonb,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);
CREATE INDEX IF NOT EXISTS surveys_tenant_id_status_idx ON survey.surveys (tenant_id, status);

CREATE TABLE IF NOT EXISTS survey.survey_distributions (
  id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  tenant_id UUID NOT NULL,
  survey_id UUID NOT NULL,
  institution_id UUID NOT NULL,
  status VARCHAR(30) NOT NULL,
  due_date VARCHAR(32),
  submitted_at VARCHAR(32),
  reminders_sent INT NOT NULL DEFAULT 0,
  reminder_days JSONB NOT NULL DEFAULT '[]'::jsonb,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);
CREATE INDEX IF NOT EXISTS survey_distributions_tenant_id_survey_id_idx ON survey.survey_distributions (tenant_id, survey_id);

CREATE TABLE IF NOT EXISTS survey.survey_submissions (
  id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  tenant_id UUID NOT NULL,
  survey_id UUID NOT NULL,
  institution_id UUID NOT NULL,
  answers JSONB NOT NULL DEFAULT '[]'::jsonb,
  submitted_at TIMESTAMPTZ NOT NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);
CREATE INDEX IF NOT EXISTS survey_submissions_tenant_id_survey_id_idx ON survey.survey_submissions (tenant_id, survey_id);

