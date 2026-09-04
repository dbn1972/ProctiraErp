-- Phase 20: Library
CREATE SCHEMA IF NOT EXISTS library;
CREATE EXTENSION IF NOT EXISTS "uuid-ossp";

CREATE TABLE IF NOT EXISTS library.titles (
  id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  tenant_id UUID NOT NULL,
  institution_id UUID,
  title VARCHAR(255) NOT NULL,
  author VARCHAR(255),
  isbn VARCHAR(255),
  category VARCHAR(255),
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);
CREATE INDEX IF NOT EXISTS titles_tenant_id_idx ON library.titles (tenant_id);

CREATE TABLE IF NOT EXISTS library.copies (
  id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  tenant_id UUID NOT NULL,
  title_id UUID NOT NULL,
  barcode VARCHAR(255) NOT NULL,
  status VARCHAR(255) NOT NULL DEFAULT 'available',
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);
CREATE INDEX IF NOT EXISTS copies_tenant_id_idx ON library.copies (tenant_id);

CREATE TABLE IF NOT EXISTS library.loans (
  id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  tenant_id UUID NOT NULL,
  copy_id UUID NOT NULL,
  borrower_id UUID NOT NULL,
  borrower_type VARCHAR(255) NOT NULL DEFAULT 'student',
  loaned_at VARCHAR(255) NOT NULL,
  due_at VARCHAR(255) NOT NULL,
  returned_at VARCHAR(255),
  fine_invoice_id UUID,
  status VARCHAR(255) NOT NULL DEFAULT 'active',
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);
CREATE INDEX IF NOT EXISTS loans_tenant_id_idx ON library.loans (tenant_id);

