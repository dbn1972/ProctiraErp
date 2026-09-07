-- Parent portal (raw SQL — no Prisma).
-- Child links, two-way messaging, consent ledger, student fee invoices/payments.
-- Actor / user columns are TEXT so opaque JWT `sub` values persist.

CREATE TABLE IF NOT EXISTS parent_child_links (
  id UUID PRIMARY KEY,
  tenant_id UUID NOT NULL,
  parent_user_id TEXT NOT NULL,
  student_id UUID NOT NULL,
  relationship TEXT NOT NULL DEFAULT 'guardian'
    CHECK (relationship IN ('guardian', 'mother', 'father', 'other')),
  status TEXT NOT NULL DEFAULT 'active'
    CHECK (status IN ('active', 'pending', 'revoked')),
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  UNIQUE (tenant_id, parent_user_id, student_id)
);

CREATE INDEX IF NOT EXISTS idx_parent_child_links_parent
  ON parent_child_links (tenant_id, parent_user_id)
  WHERE status = 'active';

CREATE INDEX IF NOT EXISTS idx_parent_child_links_student
  ON parent_child_links (tenant_id, student_id);

CREATE TABLE IF NOT EXISTS parent_message_threads (
  id UUID PRIMARY KEY,
  tenant_id UUID NOT NULL,
  student_id UUID NOT NULL,
  subject TEXT NOT NULL,
  created_by TEXT NOT NULL,
  status TEXT NOT NULL DEFAULT 'open'
    CHECK (status IN ('open', 'closed')),
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_parent_message_threads_tenant
  ON parent_message_threads (tenant_id, updated_at DESC);

CREATE TABLE IF NOT EXISTS parent_messages (
  id UUID PRIMARY KEY,
  thread_id UUID NOT NULL REFERENCES parent_message_threads(id) ON DELETE CASCADE,
  tenant_id UUID NOT NULL,
  sender_user_id TEXT NOT NULL,
  sender_role TEXT NOT NULL DEFAULT 'parent'
    CHECK (sender_role IN ('parent', 'staff', 'system')),
  body TEXT NOT NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_parent_messages_thread
  ON parent_messages (thread_id, created_at);

CREATE TABLE IF NOT EXISTS parent_consents (
  id UUID PRIMARY KEY,
  tenant_id UUID NOT NULL,
  student_id UUID NOT NULL,
  parent_user_id TEXT NOT NULL,
  consent_type TEXT NOT NULL
    CHECK (consent_type IN (
      'photo_media',
      'medical_treatment',
      'field_trip',
      'data_sharing',
      'other'
    )),
  title TEXT NOT NULL,
  description TEXT NOT NULL DEFAULT '',
  status TEXT NOT NULL DEFAULT 'pending'
    CHECK (status IN ('pending', 'approved', 'denied', 'revoked')),
  decided_at TIMESTAMPTZ,
  created_by TEXT,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_parent_consents_parent
  ON parent_consents (tenant_id, parent_user_id, status);

CREATE TABLE IF NOT EXISTS parent_fee_invoices (
  id UUID PRIMARY KEY,
  tenant_id UUID NOT NULL,
  student_id UUID NOT NULL,
  title TEXT NOT NULL,
  description TEXT NOT NULL DEFAULT '',
  amount_cents INTEGER NOT NULL CHECK (amount_cents >= 0),
  currency TEXT NOT NULL DEFAULT 'INR',
  status TEXT NOT NULL DEFAULT 'open'
    CHECK (status IN ('open', 'paid', 'void', 'overdue')),
  due_at TIMESTAMPTZ,
  created_by TEXT,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_parent_fee_invoices_student
  ON parent_fee_invoices (tenant_id, student_id, status);

CREATE TABLE IF NOT EXISTS parent_fee_payments (
  id UUID PRIMARY KEY,
  invoice_id UUID NOT NULL REFERENCES parent_fee_invoices(id),
  tenant_id UUID NOT NULL,
  payer_user_id TEXT NOT NULL,
  amount_cents INTEGER NOT NULL CHECK (amount_cents >= 0),
  method TEXT NOT NULL DEFAULT 'sandbox'
    CHECK (method IN ('sandbox', 'upi', 'card', 'cash')),
  status TEXT NOT NULL DEFAULT 'succeeded'
    CHECK (status IN ('pending', 'succeeded', 'failed')),
  paid_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_parent_fee_payments_invoice
  ON parent_fee_payments (invoice_id);
