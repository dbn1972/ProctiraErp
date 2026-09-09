-- Library ops (Wave 9 / G-916): copy barcodes, holds queue, fine policy + fines.
-- Raw SQL — applied after 009 via tools/scripts/apply-sql.sh.
--
-- ALTER TABLE … ADD COLUMN IF NOT EXISTS keeps 009 catalogues compatible.
-- New tables carry tenant_id + FORCE RLS (same contract as 030).

ALTER TABLE library_items
  ADD COLUMN IF NOT EXISTS barcode TEXT;
ALTER TABLE library_items
  ADD COLUMN IF NOT EXISTS accession_no TEXT;
ALTER TABLE library_items
  ADD COLUMN IF NOT EXISTS publisher TEXT;
ALTER TABLE library_items
  ADD COLUMN IF NOT EXISTS published_year INT;

ALTER TABLE library_loans
  ADD COLUMN IF NOT EXISTS copy_id UUID;
ALTER TABLE library_loans
  ADD COLUMN IF NOT EXISTS barcode TEXT;

CREATE TABLE IF NOT EXISTS library_copies (
  id UUID PRIMARY KEY,
  tenant_id UUID NOT NULL,
  item_id UUID NOT NULL REFERENCES library_items(id) ON DELETE CASCADE,
  barcode TEXT NOT NULL,
  accession_no TEXT,
  status TEXT NOT NULL DEFAULT 'available'
    CHECK (status IN ('available', 'on_loan', 'reserved')),
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  UNIQUE (tenant_id, barcode)
);
CREATE INDEX IF NOT EXISTS library_copies_tenant_item_idx
  ON library_copies (tenant_id, item_id, status);

CREATE TABLE IF NOT EXISTS library_holds (
  id UUID PRIMARY KEY,
  tenant_id UUID NOT NULL,
  item_id UUID NOT NULL REFERENCES library_items(id) ON DELETE CASCADE,
  copy_id UUID REFERENCES library_copies(id) ON DELETE SET NULL,
  patron_user_id UUID,
  student_id UUID,
  position INT NOT NULL CHECK (position >= 1),
  status TEXT NOT NULL DEFAULT 'queued'
    CHECK (status IN ('queued', 'ready', 'fulfilled', 'expired', 'cancelled')),
  expires_at TIMESTAMPTZ,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  CHECK (patron_user_id IS NOT NULL OR student_id IS NOT NULL)
);
CREATE INDEX IF NOT EXISTS library_holds_tenant_item_idx
  ON library_holds (tenant_id, item_id, status, position);

CREATE TABLE IF NOT EXISTS library_fine_policies (
  id UUID PRIMARY KEY,
  tenant_id UUID NOT NULL,
  cents_per_day INT NOT NULL DEFAULT 500 CHECK (cents_per_day >= 0),
  cap_cents INT NOT NULL DEFAULT 5000 CHECK (cap_cents >= 0),
  currency TEXT NOT NULL DEFAULT 'INR',
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  UNIQUE (tenant_id)
);

CREATE TABLE IF NOT EXISTS library_fines (
  id UUID PRIMARY KEY,
  tenant_id UUID NOT NULL,
  loan_id UUID NOT NULL REFERENCES library_loans(id),
  student_id UUID NOT NULL,
  amount_cents INT NOT NULL CHECK (amount_cents > 0),
  currency TEXT NOT NULL DEFAULT 'INR',
  overdue_days INT NOT NULL DEFAULT 0 CHECK (overdue_days >= 0),
  status TEXT NOT NULL DEFAULT 'open'
    CHECK (status IN ('open', 'paid', 'waived')),
  invoice_id TEXT,
  paid_at TIMESTAMPTZ,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS library_fines_tenant_student_idx
  ON library_fines (tenant_id, student_id, status);

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint WHERE conname = 'library_loans_copy_id_fkey'
  ) THEN
    ALTER TABLE library_loans
      ADD CONSTRAINT library_loans_copy_id_fkey
      FOREIGN KEY (copy_id) REFERENCES library_copies(id)
      ON DELETE SET NULL;
  END IF;
END $$;

-- ---------------------------------------------------------------------------
-- RLS (same policy shape as 030; tenant bound via withPgTenant / app.tenant_id)
-- ---------------------------------------------------------------------------
ALTER TABLE library_copies ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS tenant_isolation ON library_copies;
CREATE POLICY tenant_isolation ON library_copies
  FOR ALL
  USING (tenant_id::text = NULLIF(current_setting('app.tenant_id', true), ''))
  WITH CHECK (tenant_id::text = NULLIF(current_setting('app.tenant_id', true), ''));
ALTER TABLE library_copies FORCE ROW LEVEL SECURITY;

ALTER TABLE library_holds ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS tenant_isolation ON library_holds;
CREATE POLICY tenant_isolation ON library_holds
  FOR ALL
  USING (tenant_id::text = NULLIF(current_setting('app.tenant_id', true), ''))
  WITH CHECK (tenant_id::text = NULLIF(current_setting('app.tenant_id', true), ''));
ALTER TABLE library_holds FORCE ROW LEVEL SECURITY;

ALTER TABLE library_fine_policies ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS tenant_isolation ON library_fine_policies;
CREATE POLICY tenant_isolation ON library_fine_policies
  FOR ALL
  USING (tenant_id::text = NULLIF(current_setting('app.tenant_id', true), ''))
  WITH CHECK (tenant_id::text = NULLIF(current_setting('app.tenant_id', true), ''));
ALTER TABLE library_fine_policies FORCE ROW LEVEL SECURITY;

ALTER TABLE library_fines ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS tenant_isolation ON library_fines;
CREATE POLICY tenant_isolation ON library_fines
  FOR ALL
  USING (tenant_id::text = NULLIF(current_setting('app.tenant_id', true), ''))
  WITH CHECK (tenant_id::text = NULLIF(current_setting('app.tenant_id', true), ''));
ALTER TABLE library_fines FORCE ROW LEVEL SECURITY;
