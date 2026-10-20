-- PRC-M169: attendance institution config / absence-threshold config / leave
-- types never had a backing table — PrismaAttendanceRepository.
-- getInstitutionAttendanceConfig/getAbsenceThresholdConfig hardcoded `null`,
-- so recording-mode/leave-type/alert rules configured by an institution never
-- took effect. Additive only: every table below is created idempotently
-- (IF NOT EXISTS), and no existing table is altered. Transactional (no
-- CONCURRENTLY).
--
-- RLS: same tenant_isolation policy shape as db/sql/042_attendance_ops_schema.sql
-- (ENABLE + FORCE ROW LEVEL SECURITY, policy on
-- tenant_id::text = NULLIF(current_setting('app.tenant_id', true), '')).

CREATE TABLE IF NOT EXISTS attendance_institution_config (
  tenant_id UUID NOT NULL,
  institution_id UUID NOT NULL,
  recording_mode TEXT NOT NULL DEFAULT 'class'
    CHECK (recording_mode IN ('class', 'subject', 'period')),
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  PRIMARY KEY (tenant_id, institution_id)
);

CREATE TABLE IF NOT EXISTS attendance_absence_threshold_config (
  tenant_id UUID NOT NULL,
  institution_id UUID NOT NULL,
  threshold INT NOT NULL CHECK (threshold >= 0),
  evaluation_period_days INT NOT NULL CHECK (evaluation_period_days > 0),
  recipient_role_ids TEXT[] NOT NULL DEFAULT '{}',
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  PRIMARY KEY (tenant_id, institution_id)
);

CREATE TABLE IF NOT EXISTS attendance_leave_types (
  id UUID PRIMARY KEY,
  tenant_id UUID NOT NULL,
  institution_id UUID NOT NULL,
  code TEXT NOT NULL,
  name TEXT NOT NULL,
  is_active BOOLEAN NOT NULL DEFAULT true,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  UNIQUE (tenant_id, institution_id, code)
);
CREATE INDEX IF NOT EXISTS attendance_leave_types_tenant_institution_idx
  ON attendance_leave_types (tenant_id, institution_id);

-- ---------------------------------------------------------------------------
-- RLS (same policy shape as db/sql/042; tenant bound via withPgTenant)
-- ---------------------------------------------------------------------------
ALTER TABLE attendance_institution_config ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS tenant_isolation ON attendance_institution_config;
CREATE POLICY tenant_isolation ON attendance_institution_config
  FOR ALL
  USING (tenant_id::text = NULLIF(current_setting('app.tenant_id', true), ''))
  WITH CHECK (tenant_id::text = NULLIF(current_setting('app.tenant_id', true), ''));
ALTER TABLE attendance_institution_config FORCE ROW LEVEL SECURITY;

ALTER TABLE attendance_absence_threshold_config ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS tenant_isolation ON attendance_absence_threshold_config;
CREATE POLICY tenant_isolation ON attendance_absence_threshold_config
  FOR ALL
  USING (tenant_id::text = NULLIF(current_setting('app.tenant_id', true), ''))
  WITH CHECK (tenant_id::text = NULLIF(current_setting('app.tenant_id', true), ''));
ALTER TABLE attendance_absence_threshold_config FORCE ROW LEVEL SECURITY;

ALTER TABLE attendance_leave_types ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS tenant_isolation ON attendance_leave_types;
CREATE POLICY tenant_isolation ON attendance_leave_types
  FOR ALL
  USING (tenant_id::text = NULLIF(current_setting('app.tenant_id', true), ''))
  WITH CHECK (tenant_id::text = NULLIF(current_setting('app.tenant_id', true), ''));
ALTER TABLE attendance_leave_types FORCE ROW LEVEL SECURITY;
