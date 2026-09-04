-- Phase schema ownership: scholarship (charter §19)
-- CREATE SCHEMA + tables; bare UUID tenant/cross-domain ids (no cross-schema FKs).

CREATE SCHEMA IF NOT EXISTS scholarship;
CREATE EXTENSION IF NOT EXISTS "uuid-ossp";

CREATE TABLE IF NOT EXISTS scholarship.scholarship_programs (
  id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  tenant_id UUID NOT NULL,
  name VARCHAR(255) NOT NULL,
  description TEXT,
  application_start_date VARCHAR(32) NOT NULL,
  application_end_date VARCHAR(32) NOT NULL,
  total_slots INT NOT NULL,
  used_slots INT NOT NULL DEFAULT 0,
  amount_per_recipient DOUBLE PRECISION NOT NULL,
  currency VARCHAR(10) NOT NULL,
  disbursement_frequency VARCHAR(30) NOT NULL,
  eligibility JSONB NOT NULL DEFAULT '{}'::jsonb,
  status VARCHAR(20) NOT NULL DEFAULT 'draft',
  academic_period_id UUID,
  funding_source_id UUID,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);
CREATE INDEX IF NOT EXISTS scholarship_programs_tenant_id_status_idx ON scholarship.scholarship_programs (tenant_id, status);

CREATE TABLE IF NOT EXISTS scholarship.scholarship_applications (
  id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  tenant_id UUID NOT NULL,
  program_id UUID NOT NULL,
  applicant_id UUID NOT NULL,
  institution_id UUID NOT NULL,
  status VARCHAR(30) NOT NULL DEFAULT 'draft',
  academic_records JSONB NOT NULL DEFAULT '[]'::jsonb,
  financial_info JSONB NOT NULL DEFAULT '{}'::jsonb,
  documents JSONB NOT NULL DEFAULT '[]'::jsonb,
  personal_statement TEXT,
  area_id UUID,
  gender VARCHAR(20),
  workflow_instance_id UUID,
  submitted_at TIMESTAMPTZ NOT NULL,
  reviewed_at TIMESTAMPTZ,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);
CREATE INDEX IF NOT EXISTS scholarship_applications_tenant_id_program_id_status_idx ON scholarship.scholarship_applications (tenant_id, program_id, status);
CREATE INDEX IF NOT EXISTS scholarship_applications_tenant_id_applicant_id_idx ON scholarship.scholarship_applications (tenant_id, applicant_id);

CREATE TABLE IF NOT EXISTS scholarship.scholarship_disbursements (
  id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  tenant_id UUID NOT NULL,
  application_id UUID NOT NULL,
  amount DOUBLE PRECISION NOT NULL,
  scheduled_date VARCHAR(32) NOT NULL,
  paid_date VARCHAR(32),
  payment_status VARCHAR(30) NOT NULL,
  payment_method VARCHAR(30),
  transaction_reference VARCHAR(255),
  notes TEXT,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);
CREATE INDEX IF NOT EXISTS scholarship_disbursements_tenant_id_application_id_idx ON scholarship.scholarship_disbursements (tenant_id, application_id);

CREATE TABLE IF NOT EXISTS scholarship.scholarship_compliance_records (
  id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  tenant_id UUID NOT NULL,
  application_id UUID NOT NULL,
  compliance_type VARCHAR(50) NOT NULL,
  status VARCHAR(30) NOT NULL,
  evaluation_date VARCHAR(32) NOT NULL,
  details TEXT,
  evaluator_id UUID,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);
CREATE INDEX IF NOT EXISTS scholarship_compliance_records_tenant_id_application_id_idx ON scholarship.scholarship_compliance_records (tenant_id, application_id);

