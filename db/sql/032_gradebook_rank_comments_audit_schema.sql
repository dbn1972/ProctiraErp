-- Gradebook rank / comments bank / grade-change audit (Wave 9 / G-907).
-- Raw SQL — applied after 030 via tools/scripts/apply-sql.sh.
-- RLS: tenant bound via withPgTenant / app.tenant_id; FORCE ROW LEVEL SECURITY.

ALTER TABLE grade_entries
  ADD COLUMN IF NOT EXISTS published_at TIMESTAMPTZ;

CREATE INDEX IF NOT EXISTS grade_entries_tenant_published_idx
  ON grade_entries (tenant_id, published_at)
  WHERE published_at IS NOT NULL;

-- ---------------------------------------------------------------------------
-- Append-only grade-change audit (score edits + workflow transitions)
-- ---------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS grade_change_audit (
  id UUID PRIMARY KEY,
  tenant_id UUID NOT NULL,
  grade_entry_id UUID NOT NULL,
  action TEXT NOT NULL,
  from_status TEXT,
  to_status TEXT,
  from_numeric_score NUMERIC(6,2),
  to_numeric_score NUMERIC(6,2),
  from_letter_grade TEXT,
  to_letter_grade TEXT,
  actor_id TEXT,
  details JSONB NOT NULL DEFAULT '{}'::jsonb,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS grade_change_audit_entry_idx
  ON grade_change_audit (tenant_id, grade_entry_id, created_at);

-- ---------------------------------------------------------------------------
-- Reusable remarks per subject / grade band
-- ---------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS comments_bank (
  id UUID PRIMARY KEY,
  tenant_id UUID NOT NULL,
  institution_id UUID,
  subject_id UUID,
  grade_band TEXT,
  label TEXT NOT NULL,
  body TEXT NOT NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS comments_bank_lookup_idx
  ON comments_bank (tenant_id, subject_id, grade_band);

-- ---------------------------------------------------------------------------
-- Class rank + CGPA snapshots (one batch per compute)
-- ---------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS class_rank_snapshots (
  id UUID PRIMARY KEY,
  tenant_id UUID NOT NULL,
  section_id UUID NOT NULL,
  academic_period_id UUID,
  batch_id UUID NOT NULL,
  student_id TEXT NOT NULL,
  class_rank INTEGER NOT NULL,
  tie_count INTEGER NOT NULL DEFAULT 1,
  weighted_gpa NUMERIC(8,4),
  unweighted_gpa NUMERIC(8,4),
  cgpa NUMERIC(8,4),
  credits_earned NUMERIC(8,2),
  computed_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  metadata JSONB NOT NULL DEFAULT '{}'::jsonb
);
CREATE INDEX IF NOT EXISTS class_rank_snapshots_section_idx
  ON class_rank_snapshots (tenant_id, section_id, computed_at DESC);
CREATE INDEX IF NOT EXISTS class_rank_snapshots_batch_idx
  ON class_rank_snapshots (tenant_id, batch_id);

-- ---------------------------------------------------------------------------
-- RLS (same policy shape as 030; tenant bound via withPgTenant / app.tenant_id)
-- ---------------------------------------------------------------------------
ALTER TABLE grade_change_audit ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS tenant_isolation ON grade_change_audit;
CREATE POLICY tenant_isolation ON grade_change_audit
  FOR ALL
  USING (tenant_id::text = NULLIF(current_setting('app.tenant_id', true), ''))
  WITH CHECK (tenant_id::text = NULLIF(current_setting('app.tenant_id', true), ''));
ALTER TABLE grade_change_audit FORCE ROW LEVEL SECURITY;

ALTER TABLE comments_bank ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS tenant_isolation ON comments_bank;
CREATE POLICY tenant_isolation ON comments_bank
  FOR ALL
  USING (tenant_id::text = NULLIF(current_setting('app.tenant_id', true), ''))
  WITH CHECK (tenant_id::text = NULLIF(current_setting('app.tenant_id', true), ''));
ALTER TABLE comments_bank FORCE ROW LEVEL SECURITY;

ALTER TABLE class_rank_snapshots ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS tenant_isolation ON class_rank_snapshots;
CREATE POLICY tenant_isolation ON class_rank_snapshots
  FOR ALL
  USING (tenant_id::text = NULLIF(current_setting('app.tenant_id', true), ''))
  WITH CHECK (tenant_id::text = NULLIF(current_setting('app.tenant_id', true), ''));
ALTER TABLE class_rank_snapshots FORCE ROW LEVEL SECURITY;
