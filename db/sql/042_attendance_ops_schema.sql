-- Attendance ops (Wave 9 / G-919): regularisation, student leave, device ingest,
-- EARLY_DEPARTURE status check.
-- Raw SQL — applied after 041 via tools/scripts/apply-sql.sh.
--
-- EARLY_DEPARTURE present-partial rule (documented for percentage calc):
--   numerator = PRESENT + LATE + 0.5 * EARLY_DEPARTURE
--   denominator = all records in range (including EXCUSED and EARLY_DEPARTURE)
--   absence % uses ABSENT only.
--
-- RLS: tenant bound via withPgTenant / app.tenant_id (same policy shape as 036).

CREATE TABLE IF NOT EXISTS attendance_regularisation_requests (
  id UUID PRIMARY KEY,
  tenant_id UUID NOT NULL,
  attendance_id UUID NOT NULL,
  student_id UUID NOT NULL,
  institution_id UUID NOT NULL,
  class_id UUID NOT NULL,
  attendance_date DATE NOT NULL,
  from_status TEXT NOT NULL,
  to_status TEXT NOT NULL
    CHECK (to_status IN ('PRESENT', 'ABSENT', 'LATE', 'EXCUSED', 'EARLY_DEPARTURE')),
  reason TEXT,
  requester_id TEXT NOT NULL,
  requester_role TEXT,
  status TEXT NOT NULL
    CHECK (status IN ('requested', 'approved', 'rejected')),
  decided_by TEXT,
  decided_at TIMESTAMPTZ,
  decision_note TEXT,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS attendance_regularisation_tenant_idx
  ON attendance_regularisation_requests (tenant_id, status, created_at DESC);

CREATE TABLE IF NOT EXISTS attendance_leave_requests (
  id UUID PRIMARY KEY,
  tenant_id UUID NOT NULL,
  student_id UUID NOT NULL,
  institution_id UUID NOT NULL,
  class_id UUID NOT NULL,
  academic_period_id UUID NOT NULL,
  from_date DATE NOT NULL,
  to_date DATE NOT NULL,
  reason TEXT,
  attachment_url TEXT,
  requester_id TEXT NOT NULL,
  requester_role TEXT,
  status TEXT NOT NULL
    CHECK (status IN ('requested', 'approved', 'rejected')),
  decided_by TEXT,
  decided_at TIMESTAMPTZ,
  decision_note TEXT,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  CHECK (to_date >= from_date)
);
CREATE INDEX IF NOT EXISTS attendance_leave_tenant_idx
  ON attendance_leave_requests (tenant_id, student_id, status);

CREATE TABLE IF NOT EXISTS attendance_device_keys (
  id UUID PRIMARY KEY,
  tenant_id UUID NOT NULL,
  institution_id UUID NOT NULL,
  device_id TEXT NOT NULL,
  api_key_hash TEXT NOT NULL,
  label TEXT,
  status TEXT NOT NULL DEFAULT 'active'
    CHECK (status IN ('active', 'revoked')),
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  UNIQUE (tenant_id, institution_id, device_id),
  UNIQUE (tenant_id, api_key_hash)
);
CREATE INDEX IF NOT EXISTS attendance_device_keys_inst_idx
  ON attendance_device_keys (tenant_id, institution_id);

CREATE TABLE IF NOT EXISTS attendance_ingest_events (
  id UUID PRIMARY KEY,
  tenant_id UUID NOT NULL,
  institution_id UUID NOT NULL,
  device_id TEXT NOT NULL,
  event_id TEXT NOT NULL,
  student_id UUID NOT NULL,
  punched_at TIMESTAMPTZ NOT NULL,
  punch_type TEXT NOT NULL
    CHECK (punch_type IN ('IN', 'OUT')),
  attendance_id UUID,
  duplicate BOOLEAN NOT NULL DEFAULT false,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  UNIQUE (tenant_id, device_id, event_id)
);
CREATE INDEX IF NOT EXISTS attendance_ingest_events_device_idx
  ON attendance_ingest_events (tenant_id, device_id, punched_at DESC);

-- Allow EARLY_DEPARTURE on existing student_attendance.status (Prisma VARCHAR).
DO $$
BEGIN
  IF EXISTS (
    SELECT 1 FROM information_schema.tables
     WHERE table_schema = 'public' AND table_name = 'student_attendance'
  ) THEN
    ALTER TABLE student_attendance DROP CONSTRAINT IF EXISTS student_attendance_status_check;
    ALTER TABLE student_attendance
      ADD CONSTRAINT student_attendance_status_check
      CHECK (status IN ('PRESENT', 'ABSENT', 'LATE', 'EXCUSED', 'EARLY_DEPARTURE'));
  END IF;
END $$;

-- ---------------------------------------------------------------------------
-- RLS (same policy shape as 027/030/036; tenant bound via withPgTenant)
-- ---------------------------------------------------------------------------
ALTER TABLE attendance_regularisation_requests ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS tenant_isolation ON attendance_regularisation_requests;
CREATE POLICY tenant_isolation ON attendance_regularisation_requests
  FOR ALL
  USING (tenant_id::text = NULLIF(current_setting('app.tenant_id', true), ''))
  WITH CHECK (tenant_id::text = NULLIF(current_setting('app.tenant_id', true), ''));
ALTER TABLE attendance_regularisation_requests FORCE ROW LEVEL SECURITY;

ALTER TABLE attendance_leave_requests ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS tenant_isolation ON attendance_leave_requests;
CREATE POLICY tenant_isolation ON attendance_leave_requests
  FOR ALL
  USING (tenant_id::text = NULLIF(current_setting('app.tenant_id', true), ''))
  WITH CHECK (tenant_id::text = NULLIF(current_setting('app.tenant_id', true), ''));
ALTER TABLE attendance_leave_requests FORCE ROW LEVEL SECURITY;

ALTER TABLE attendance_device_keys ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS tenant_isolation ON attendance_device_keys;
CREATE POLICY tenant_isolation ON attendance_device_keys
  FOR ALL
  USING (tenant_id::text = NULLIF(current_setting('app.tenant_id', true), ''))
  WITH CHECK (tenant_id::text = NULLIF(current_setting('app.tenant_id', true), ''));
ALTER TABLE attendance_device_keys FORCE ROW LEVEL SECURITY;

ALTER TABLE attendance_ingest_events ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS tenant_isolation ON attendance_ingest_events;
CREATE POLICY tenant_isolation ON attendance_ingest_events
  FOR ALL
  USING (tenant_id::text = NULLIF(current_setting('app.tenant_id', true), ''))
  WITH CHECK (tenant_id::text = NULLIF(current_setting('app.tenant_id', true), ''));
ALTER TABLE attendance_ingest_events FORCE ROW LEVEL SECURITY;
