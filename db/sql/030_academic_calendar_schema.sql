-- Academic calendar (Wave 9 / G-905): year → term hierarchy on academic_periods
-- plus per-period calendar events (holidays, breaks, grading / exam windows).
-- Raw SQL — applied after 029 via tools/scripts/apply-sql.sh.
--
-- The hierarchy columns mirror the Prisma migration
-- 20260909_academic_period_hierarchy so raw-SQL-only setups converge on the
-- same shape. Calendar events are not Prisma-managed (PgCalendarStore).

ALTER TABLE academic_periods
  ADD COLUMN IF NOT EXISTS kind VARCHAR(20) NOT NULL DEFAULT 'year';
ALTER TABLE academic_periods
  ADD COLUMN IF NOT EXISTS parent_id UUID;
DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint WHERE conname = 'academic_periods_parent_id_fkey'
  ) THEN
    ALTER TABLE academic_periods
      ADD CONSTRAINT academic_periods_parent_id_fkey
      FOREIGN KEY (parent_id) REFERENCES academic_periods(id)
      ON DELETE SET NULL ON UPDATE CASCADE;
  END IF;
END $$;
CREATE INDEX IF NOT EXISTS academic_periods_tenant_id_parent_id_idx
  ON academic_periods (tenant_id, parent_id);

CREATE TABLE IF NOT EXISTS academic_calendar_events (
  id UUID PRIMARY KEY,
  tenant_id UUID NOT NULL,
  academic_period_id UUID NOT NULL REFERENCES academic_periods(id) ON DELETE CASCADE,
  -- NULL = applies to every institution in the tenant.
  institution_id UUID,
  kind TEXT NOT NULL
    CHECK (kind IN ('holiday', 'break', 'grading_window', 'exam_window', 'event')),
  name TEXT NOT NULL,
  start_date DATE NOT NULL,
  end_date DATE NOT NULL,
  notes TEXT,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  CHECK (end_date >= start_date)
);
CREATE INDEX IF NOT EXISTS academic_calendar_events_period_idx
  ON academic_calendar_events (tenant_id, academic_period_id, start_date);

-- ---------------------------------------------------------------------------
-- RLS (same policy shape as 027; tenant bound via withPgTenant / app.tenant_id)
-- ---------------------------------------------------------------------------
ALTER TABLE academic_calendar_events ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS tenant_isolation ON academic_calendar_events;
CREATE POLICY tenant_isolation ON academic_calendar_events
  FOR ALL
  USING (tenant_id::text = NULLIF(current_setting('app.tenant_id', true), ''))
  WITH CHECK (tenant_id::text = NULLIF(current_setting('app.tenant_id', true), ''));
ALTER TABLE academic_calendar_events FORCE ROW LEVEL SECURITY;
