-- PRC-L107: per-tenant invoice and receipt number sequences.
--
-- FeesService numbered invoices and receipts as INV-/RCP-<yyyymmdd>-<first 8
-- hex chars of a random UUID>. The numbers were not sequential, and two
-- documents could draw the same 32-bit suffix on the same day; the
-- (tenant_id, invoice_number) / (tenant_id, receipt_number) unique indexes
-- then turned the collision into a 500 for the user.
--
-- Fix: fee_document_sequences keeps one counter per (tenant_id, kind).
-- PgFeesRepository.nextDocumentNumber increments it with
--   INSERT ... ON CONFLICT (tenant_id, kind) DO UPDATE SET last_value = last_value + 1
--   RETURNING last_value
-- inside the same transaction that inserts the invoice or receipt. The row
-- lock serialises concurrent issuers of one tenant and kind, and a rolled-back
-- document rolls its number back too, so numbers are unique and gap-free per
-- tenant. Numbers become INV-/RCP-<yyyymmdd>-<counter, at least 6 digits>.
-- Existing documents keep their numbers; new counters start at 1 (a 6-digit
-- decimal suffix cannot equal an existing 8-character hex suffix).
--
-- Tenant-owned: RLS + FORCE with the app.tenant_id policy; runtime grant class
-- dml (db/runtime-table-privileges.json); privacy registry class retained
-- (fees).
--
-- Rollback (forward migration): DROP TABLE fee_document_sequences; the
-- service would need the previous numbering code back.
CREATE TABLE IF NOT EXISTS fee_document_sequences (
  tenant_id   UUID NOT NULL REFERENCES tenants(id),
  kind        TEXT NOT NULL CHECK (kind IN ('invoice', 'receipt')),
  last_value  BIGINT NOT NULL CHECK (last_value >= 1),
  updated_at  TIMESTAMPTZ NOT NULL DEFAULT now(),
  PRIMARY KEY (tenant_id, kind)
);
ALTER TABLE fee_document_sequences ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS tenant_isolation ON fee_document_sequences;
CREATE POLICY tenant_isolation ON fee_document_sequences
  FOR ALL
  USING (tenant_id = app_tenant_uuid())
  WITH CHECK (tenant_id = app_tenant_uuid());
ALTER TABLE fee_document_sequences FORCE ROW LEVEL SECURITY;
INSERT INTO schema_migrations (filename)
VALUES ('324_fee_document_sequences.sql')
ON CONFLICT (filename) DO NOTHING;
