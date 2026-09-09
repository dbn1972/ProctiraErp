-- Examination ops (Wave 9 / G-908): invigilator allocation, persisted seating,
-- double marks entry, re-evaluation workflow.
-- Raw SQL — applied after 030 via tools/scripts/apply-sql.sh.
--
-- RLS: tenant bound via withPgTenant / app.tenant_id (same policy shape as 030).

CREATE TABLE IF NOT EXISTS exam_sessions (
  id UUID PRIMARY KEY,
  tenant_id UUID NOT NULL,
  examination_id UUID NOT NULL,
  subject_id UUID NOT NULL,
  session_date DATE NOT NULL,
  start_time TIME NOT NULL,
  end_time TIME NOT NULL,
  room_id TEXT NOT NULL,
  center_id UUID,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  CHECK (end_time > start_time)
);
CREATE INDEX IF NOT EXISTS exam_sessions_exam_idx
  ON exam_sessions (tenant_id, examination_id, session_date);
CREATE INDEX IF NOT EXISTS exam_sessions_room_idx
  ON exam_sessions (tenant_id, room_id, session_date);

CREATE TABLE IF NOT EXISTS exam_invigilators (
  id UUID PRIMARY KEY,
  tenant_id UUID NOT NULL,
  session_id UUID NOT NULL REFERENCES exam_sessions(id) ON DELETE CASCADE,
  staff_id UUID NOT NULL,
  allocated_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  allocated_by TEXT,
  UNIQUE (tenant_id, session_id, staff_id)
);
CREATE INDEX IF NOT EXISTS exam_invigilators_staff_idx
  ON exam_invigilators (tenant_id, staff_id);

CREATE TABLE IF NOT EXISTS exam_seating (
  id UUID PRIMARY KEY,
  tenant_id UUID NOT NULL,
  examination_id UUID NOT NULL,
  session_id UUID REFERENCES exam_sessions(id) ON DELETE SET NULL,
  candidate_id UUID NOT NULL,
  student_id UUID,
  student_name TEXT NOT NULL,
  roll_number TEXT NOT NULL,
  center_id UUID NOT NULL,
  center_name TEXT NOT NULL,
  room_number TEXT NOT NULL,
  seat_number TEXT NOT NULL,
  subject_names TEXT[] NOT NULL DEFAULT '{}',
  generated_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  UNIQUE (tenant_id, examination_id, candidate_id)
);
CREATE INDEX IF NOT EXISTS exam_seating_exam_idx
  ON exam_seating (tenant_id, examination_id, center_id);

CREATE TABLE IF NOT EXISTS exam_marks_entries (
  id UUID PRIMARY KEY,
  tenant_id UUID NOT NULL,
  examination_id UUID NOT NULL,
  candidate_id UUID NOT NULL,
  subject_id UUID NOT NULL,
  entry_no SMALLINT NOT NULL CHECK (entry_no IN (1, 2)),
  marks NUMERIC(8,2) NOT NULL,
  entered_by TEXT NOT NULL,
  entered_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  variance_flag BOOLEAN NOT NULL DEFAULT false,
  final_marks NUMERIC(8,2),
  resolved_by TEXT,
  resolved_at TIMESTAMPTZ,
  UNIQUE (tenant_id, examination_id, candidate_id, subject_id, entry_no)
);
CREATE INDEX IF NOT EXISTS exam_marks_entries_exam_idx
  ON exam_marks_entries (tenant_id, examination_id, candidate_id);

CREATE TABLE IF NOT EXISTS exam_reevaluation_requests (
  id UUID PRIMARY KEY,
  tenant_id UUID NOT NULL,
  examination_id UUID NOT NULL,
  candidate_id UUID NOT NULL,
  subject_id UUID NOT NULL,
  status TEXT NOT NULL
    CHECK (status IN ('requested', 'assigned', 'completed', 'rejected')),
  requester_id TEXT NOT NULL,
  requester_role TEXT,
  evaluator_id TEXT,
  original_marks NUMERIC(8,2),
  revised_marks NUMERIC(8,2),
  fee_required BOOLEAN NOT NULL DEFAULT false,
  fee_amount NUMERIC(12,2),
  notes TEXT,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS exam_reevaluation_exam_idx
  ON exam_reevaluation_requests (tenant_id, examination_id, status);

-- ---------------------------------------------------------------------------
-- RLS (same policy shape as 027/030; tenant bound via withPgTenant)
-- ---------------------------------------------------------------------------
ALTER TABLE exam_sessions ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS tenant_isolation ON exam_sessions;
CREATE POLICY tenant_isolation ON exam_sessions
  FOR ALL
  USING (tenant_id::text = NULLIF(current_setting('app.tenant_id', true), ''))
  WITH CHECK (tenant_id::text = NULLIF(current_setting('app.tenant_id', true), ''));
ALTER TABLE exam_sessions FORCE ROW LEVEL SECURITY;

ALTER TABLE exam_invigilators ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS tenant_isolation ON exam_invigilators;
CREATE POLICY tenant_isolation ON exam_invigilators
  FOR ALL
  USING (tenant_id::text = NULLIF(current_setting('app.tenant_id', true), ''))
  WITH CHECK (tenant_id::text = NULLIF(current_setting('app.tenant_id', true), ''));
ALTER TABLE exam_invigilators FORCE ROW LEVEL SECURITY;

ALTER TABLE exam_seating ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS tenant_isolation ON exam_seating;
CREATE POLICY tenant_isolation ON exam_seating
  FOR ALL
  USING (tenant_id::text = NULLIF(current_setting('app.tenant_id', true), ''))
  WITH CHECK (tenant_id::text = NULLIF(current_setting('app.tenant_id', true), ''));
ALTER TABLE exam_seating FORCE ROW LEVEL SECURITY;

ALTER TABLE exam_marks_entries ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS tenant_isolation ON exam_marks_entries;
CREATE POLICY tenant_isolation ON exam_marks_entries
  FOR ALL
  USING (tenant_id::text = NULLIF(current_setting('app.tenant_id', true), ''))
  WITH CHECK (tenant_id::text = NULLIF(current_setting('app.tenant_id', true), ''));
ALTER TABLE exam_marks_entries FORCE ROW LEVEL SECURITY;

ALTER TABLE exam_reevaluation_requests ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS tenant_isolation ON exam_reevaluation_requests;
CREATE POLICY tenant_isolation ON exam_reevaluation_requests
  FOR ALL
  USING (tenant_id::text = NULLIF(current_setting('app.tenant_id', true), ''))
  WITH CHECK (tenant_id::text = NULLIF(current_setting('app.tenant_id', true), ''));
ALTER TABLE exam_reevaluation_requests FORCE ROW LEVEL SECURITY;
