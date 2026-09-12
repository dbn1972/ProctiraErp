-- P0-03: relationship-scoped guardian authority on parent_child_links.
-- Backward-compatible defaults preserve full access for existing seeds/links.

ALTER TABLE parent_child_links
  ADD COLUMN IF NOT EXISTS is_primary BOOLEAN NOT NULL DEFAULT true;

ALTER TABLE parent_child_links
  ADD COLUMN IF NOT EXISTS can_consent_medical BOOLEAN NOT NULL DEFAULT true;

ALTER TABLE parent_child_links
  ADD COLUMN IF NOT EXISTS can_view_fees BOOLEAN NOT NULL DEFAULT true;

COMMENT ON COLUMN parent_child_links.is_primary IS
  'Primary household contact for the student (custody/authority signal).';
COMMENT ON COLUMN parent_child_links.can_consent_medical IS
  'When false, guardian may not decide medical_treatment consents.';
COMMENT ON COLUMN parent_child_links.can_view_fees IS
  'When false, guardian may not list or pay student fee invoices.';
