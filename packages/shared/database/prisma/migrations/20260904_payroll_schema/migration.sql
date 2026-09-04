-- Phase 24: Payroll
CREATE SCHEMA IF NOT EXISTS payroll;
CREATE EXTENSION IF NOT EXISTS "uuid-ossp";

CREATE TABLE IF NOT EXISTS payroll.pay_structures (
  id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  tenant_id UUID NOT NULL,
  name VARCHAR(255) NOT NULL,
  currency VARCHAR(255) NOT NULL DEFAULT 'INR',
  components TEXT NOT NULL DEFAULT '[]',
  status VARCHAR(255) NOT NULL DEFAULT 'active',
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);
CREATE INDEX IF NOT EXISTS pay_structures_tenant_id_idx ON payroll.pay_structures (tenant_id);

CREATE TABLE IF NOT EXISTS payroll.payroll_runs (
  id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  tenant_id UUID NOT NULL,
  pay_structure_id UUID,
  period_year DOUBLE PRECISION NOT NULL,
  period_month DOUBLE PRECISION NOT NULL,
  status VARCHAR(255) NOT NULL DEFAULT 'draft',
  total_amount DOUBLE PRECISION NOT NULL DEFAULT 0,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);
CREATE INDEX IF NOT EXISTS payroll_runs_tenant_id_idx ON payroll.payroll_runs (tenant_id);

CREATE TABLE IF NOT EXISTS payroll.payslips (
  id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  tenant_id UUID NOT NULL,
  payroll_run_id UUID NOT NULL,
  staff_id UUID NOT NULL,
  gross_amount DOUBLE PRECISION NOT NULL,
  net_amount DOUBLE PRECISION NOT NULL,
  status VARCHAR(255) NOT NULL DEFAULT 'generated',
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);
CREATE INDEX IF NOT EXISTS payslips_tenant_id_idx ON payroll.payslips (tenant_id);

