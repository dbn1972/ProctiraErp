-- Phase 18: Finance / Fees
CREATE SCHEMA IF NOT EXISTS finance;
CREATE EXTENSION IF NOT EXISTS "uuid-ossp";

CREATE TABLE IF NOT EXISTS finance.fee_structures (
  id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  tenant_id UUID NOT NULL,
  name VARCHAR(255) NOT NULL,
  academic_year VARCHAR(255) NOT NULL,
  amount DOUBLE PRECISION NOT NULL,
  currency VARCHAR(255) NOT NULL DEFAULT 'INR',
  frequency VARCHAR(255) NOT NULL DEFAULT 'annual',
  status VARCHAR(255) NOT NULL DEFAULT 'active',
  institution_id UUID,
  grade_id UUID,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);
CREATE INDEX IF NOT EXISTS fee_structures_tenant_id_idx ON finance.fee_structures (tenant_id);

CREATE TABLE IF NOT EXISTS finance.invoices (
  id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  tenant_id UUID NOT NULL,
  student_id UUID NOT NULL,
  enrollment_id UUID,
  fee_structure_id UUID,
  institution_id UUID,
  amount_due DOUBLE PRECISION NOT NULL,
  amount_paid DOUBLE PRECISION NOT NULL DEFAULT 0,
  currency VARCHAR(255) NOT NULL DEFAULT 'INR',
  due_date VARCHAR(255) NOT NULL,
  status VARCHAR(255) NOT NULL DEFAULT 'open',
  notes TEXT,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);
CREATE INDEX IF NOT EXISTS invoices_tenant_id_idx ON finance.invoices (tenant_id);

CREATE TABLE IF NOT EXISTS finance.payments (
  id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  tenant_id UUID NOT NULL,
  invoice_id UUID NOT NULL,
  student_id UUID NOT NULL,
  amount DOUBLE PRECISION NOT NULL,
  method VARCHAR(255) NOT NULL DEFAULT 'cash',
  reference VARCHAR(255),
  paid_at VARCHAR(255) NOT NULL,
  recorded_by_user_id UUID,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);
CREATE INDEX IF NOT EXISTS payments_tenant_id_idx ON finance.payments (tenant_id);

