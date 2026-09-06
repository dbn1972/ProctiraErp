-- Health counselling sessions (raw SQL — no Prisma).
-- Used by @proctira/backend-health Pg overlay when DATABASE_URL is set.

CREATE TABLE IF NOT EXISTS counselling_sessions (
  id UUID PRIMARY KEY,
  tenant_id TEXT NOT NULL,
  student_id TEXT NOT NULL,
  counsellor_id TEXT NOT NULL,
  session_date DATE NOT NULL,
  session_type TEXT NOT NULL,
  reason TEXT NOT NULL,
  case_notes TEXT NOT NULL,
  outcome TEXT,
  follow_up_required BOOLEAN NOT NULL DEFAULT FALSE,
  follow_up_date DATE,
  status TEXT NOT NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_counselling_sessions_tenant
  ON counselling_sessions (tenant_id);

CREATE INDEX IF NOT EXISTS idx_counselling_sessions_tenant_student
  ON counselling_sessions (tenant_id, student_id);

CREATE INDEX IF NOT EXISTS idx_counselling_sessions_session_date
  ON counselling_sessions (tenant_id, session_date DESC);
