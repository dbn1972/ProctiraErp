-- Timetable generation + teacher absences (Wave 9 / G-917).
-- Raw SQL — applied after 036 via tools/scripts/apply-sql.sh.
--
-- Jobs persist generator runs (queued/running/done/failed). Teacher absences
-- drive the substitution desk (mark absent → list affected periods).
-- RLS: tenant bound via withPgTenant / app.tenant_id (same policy shape as 036).

CREATE TABLE IF NOT EXISTS timetable_generation_jobs (
  id UUID PRIMARY KEY,
  tenant_id UUID NOT NULL,
  institution_id UUID NOT NULL,
  academic_period_id UUID NOT NULL,
  bell_schedule_id UUID,
  status TEXT NOT NULL
    CHECK (status IN ('queued', 'running', 'done', 'failed')),
  requested_by TEXT,
  persist_meetings BOOLEAN NOT NULL DEFAULT false,
  teacher_max_periods_per_day SMALLINT NOT NULL DEFAULT 6,
  demand_count INTEGER NOT NULL DEFAULT 0,
  assigned_count INTEGER NOT NULL DEFAULT 0,
  unassigned_count INTEGER NOT NULL DEFAULT 0,
  clash_count INTEGER NOT NULL DEFAULT 0,
  repair_passes INTEGER NOT NULL DEFAULT 0,
  stats JSONB NOT NULL DEFAULT '{}'::jsonb,
  input JSONB NOT NULL DEFAULT '{}'::jsonb,
  result JSONB NOT NULL DEFAULT '{}'::jsonb,
  error_message TEXT,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  started_at TIMESTAMPTZ,
  finished_at TIMESTAMPTZ,
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS timetable_generation_jobs_inst_idx
  ON timetable_generation_jobs (tenant_id, institution_id, created_at DESC);

CREATE TABLE IF NOT EXISTS timetable_teacher_absences (
  id UUID PRIMARY KEY,
  tenant_id UUID NOT NULL,
  institution_id UUID NOT NULL,
  staff_id UUID NOT NULL,
  absence_date DATE NOT NULL,
  reason TEXT,
  created_by TEXT,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  UNIQUE (tenant_id, staff_id, absence_date)
);
CREATE INDEX IF NOT EXISTS timetable_teacher_absences_date_idx
  ON timetable_teacher_absences (tenant_id, institution_id, absence_date);

-- ---------------------------------------------------------------------------
-- RLS (same policy shape as 027/030/036; tenant bound via withPgTenant)
-- ---------------------------------------------------------------------------
ALTER TABLE timetable_generation_jobs ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS tenant_isolation ON timetable_generation_jobs;
CREATE POLICY tenant_isolation ON timetable_generation_jobs
  FOR ALL
  USING (tenant_id::text = NULLIF(current_setting('app.tenant_id', true), ''))
  WITH CHECK (tenant_id::text = NULLIF(current_setting('app.tenant_id', true), ''));
ALTER TABLE timetable_generation_jobs FORCE ROW LEVEL SECURITY;

ALTER TABLE timetable_teacher_absences ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS tenant_isolation ON timetable_teacher_absences;
CREATE POLICY tenant_isolation ON timetable_teacher_absences
  FOR ALL
  USING (tenant_id::text = NULLIF(current_setting('app.tenant_id', true), ''))
  WITH CHECK (tenant_id::text = NULLIF(current_setting('app.tenant_id', true), ''));
ALTER TABLE timetable_teacher_absences FORCE ROW LEVEL SECURITY;
