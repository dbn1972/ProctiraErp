-- Library module (raw SQL — no Prisma).
-- Catalog items and circulation loans.

CREATE TABLE IF NOT EXISTS library_items (
  id UUID PRIMARY KEY,
  tenant_id UUID NOT NULL,
  isbn TEXT,
  title TEXT NOT NULL,
  author TEXT,
  copies INT NOT NULL DEFAULT 1 CHECK (copies >= 0),
  available INT NOT NULL DEFAULT 1 CHECK (available >= 0),
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  CHECK (available <= copies)
);

CREATE INDEX IF NOT EXISTS idx_library_items_tenant_title
  ON library_items (tenant_id, title);

CREATE TABLE IF NOT EXISTS library_loans (
  id UUID PRIMARY KEY,
  tenant_id UUID NOT NULL,
  item_id UUID NOT NULL REFERENCES library_items(id),
  patron_user_id UUID,
  student_id UUID,
  checkout_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  due_at TIMESTAMPTZ NOT NULL,
  returned_at TIMESTAMPTZ,
  status TEXT NOT NULL DEFAULT 'checked_out'
    CHECK (status IN ('checked_out', 'returned', 'overdue')),
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  CHECK (patron_user_id IS NOT NULL OR student_id IS NOT NULL)
);

CREATE INDEX IF NOT EXISTS idx_library_loans_tenant_status
  ON library_loans (tenant_id, status);

CREATE INDEX IF NOT EXISTS idx_library_loans_tenant_due
  ON library_loans (tenant_id, due_at)
  WHERE status IN ('checked_out', 'overdue');
