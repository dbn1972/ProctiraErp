-- Production fee cycle: assignments + invoice/receipt numbers
CREATE TABLE IF NOT EXISTS finance.fee_assignments (
  id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  tenant_id UUID NOT NULL,
  fee_structure_id UUID NOT NULL,
  student_id UUID NOT NULL,
  enrollment_id UUID,
  institution_id UUID,
  concession_amount DOUBLE PRECISION NOT NULL DEFAULT 0,
  status VARCHAR(255) NOT NULL DEFAULT 'active',
  academic_year VARCHAR(255) NOT NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);
CREATE INDEX IF NOT EXISTS fee_assignments_tenant_id_idx ON finance.fee_assignments (tenant_id);
CREATE INDEX IF NOT EXISTS fee_assignments_tenant_structure_idx ON finance.fee_assignments (tenant_id, fee_structure_id);
CREATE INDEX IF NOT EXISTS fee_assignments_tenant_student_idx ON finance.fee_assignments (tenant_id, student_id);

ALTER TABLE finance.invoices ADD COLUMN IF NOT EXISTS fee_assignment_id UUID;
ALTER TABLE finance.invoices ADD COLUMN IF NOT EXISTS invoice_number VARCHAR(64);
UPDATE finance.invoices SET invoice_number = 'INV-MIGRATED-' || substr(id::text, 1, 8) WHERE invoice_number IS NULL;
ALTER TABLE finance.invoices ALTER COLUMN invoice_number SET NOT NULL;
CREATE UNIQUE INDEX IF NOT EXISTS invoices_tenant_invoice_number_key ON finance.invoices (tenant_id, invoice_number);
CREATE INDEX IF NOT EXISTS invoices_tenant_assignment_idx ON finance.invoices (tenant_id, fee_assignment_id);

ALTER TABLE finance.payments ADD COLUMN IF NOT EXISTS receipt_number VARCHAR(64);
UPDATE finance.payments SET receipt_number = 'RCPT-MIGRATED-' || substr(id::text, 1, 8) WHERE receipt_number IS NULL;
ALTER TABLE finance.payments ALTER COLUMN receipt_number SET NOT NULL;
CREATE UNIQUE INDEX IF NOT EXISTS payments_tenant_receipt_number_key ON finance.payments (tenant_id, receipt_number);
