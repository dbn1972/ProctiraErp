-- Phase schema ownership: report (charter §19)
-- CREATE SCHEMA + tables; bare UUID tenant/cross-domain ids (no cross-schema FKs).

CREATE SCHEMA IF NOT EXISTS report;
CREATE EXTENSION IF NOT EXISTS "uuid-ossp";

CREATE TABLE IF NOT EXISTS report.report_jobs (
  id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  tenant_id UUID NOT NULL,
  report_type VARCHAR(100) NOT NULL,
  format VARCHAR(20) NOT NULL,
  status VARCHAR(30) NOT NULL,
  filters JSONB NOT NULL DEFAULT '{}'::jsonb,
  group_by JSONB,
  aggregations JSONB,
  template_id UUID,
  title VARCHAR(255),
  requested_by UUID NOT NULL,
  requested_by_area VARCHAR(100),
  requested_by_role VARCHAR(100),
  file_url TEXT,
  file_size INT,
  row_count INT,
  error_message TEXT,
  started_at TIMESTAMPTZ,
  completed_at TIMESTAMPTZ,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);
CREATE INDEX IF NOT EXISTS report_jobs_tenant_id_status_idx ON report.report_jobs (tenant_id, status);

CREATE TABLE IF NOT EXISTS report.report_templates (
  id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  tenant_id UUID NOT NULL,
  name VARCHAR(255) NOT NULL,
  type VARCHAR(100) NOT NULL,
  format VARCHAR(20) NOT NULL,
  layout TEXT NOT NULL,
  merge_fields JSONB NOT NULL DEFAULT '[]'::jsonb,
  conditional_sections JSONB,
  branding JSONB,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);
CREATE INDEX IF NOT EXISTS report_templates_tenant_id_type_idx ON report.report_templates (tenant_id, type);

CREATE TABLE IF NOT EXISTS report.scheduled_reports (
  id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  tenant_id UUID NOT NULL,
  name VARCHAR(255) NOT NULL,
  report_type VARCHAR(100) NOT NULL,
  format VARCHAR(20) NOT NULL,
  filters JSONB NOT NULL DEFAULT '{}'::jsonb,
  group_by JSONB,
  aggregations JSONB,
  template_id UUID,
  cron_expression VARCHAR(100) NOT NULL,
  delivery_method VARCHAR(30) NOT NULL,
  recipient_user_ids JSONB,
  recipient_emails JSONB,
  is_active BOOLEAN NOT NULL DEFAULT TRUE,
  last_run_at TIMESTAMPTZ,
  next_run_at TIMESTAMPTZ,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);
CREATE INDEX IF NOT EXISTS scheduled_reports_tenant_id_is_active_idx ON report.scheduled_reports (tenant_id, is_active);

