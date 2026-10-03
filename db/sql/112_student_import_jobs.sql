-- PRC-H092: durable student import progress/result keyed by (tenant_id, job_id).
--
-- Async (>1000 rows) student imports kept progress in a per-process Map, so a
-- poll that landed on another gateway replica (or after a restart) saw nothing.
-- This table mirrors ImportProgress (packages/backend/student/src/import/types.ts)
-- so the worker can write progress and any instance can serve the poll, always
-- tenant-scoped. The uploaded file itself is NOT stored here (it travels on the
-- queue message); only counters, options and the result summary.
--
-- New, empty table: ordinary transactional DDL. Idempotent.
-- Rollback: forward-only; code falls back to in-process progress if absent.

CREATE TABLE IF NOT EXISTS student_import_jobs (
  tenant_id UUID NOT NULL REFERENCES tenants(id),
  job_id UUID NOT NULL,
  status TEXT NOT NULL DEFAULT 'queued'
    CHECK (status IN ('queued', 'processing', 'completed', 'failed')),
  total_rows INTEGER NOT NULL DEFAULT 0 CHECK (total_rows >= 0),
  processed_rows INTEGER NOT NULL DEFAULT 0 CHECK (processed_rows >= 0),
  progress_percent SMALLINT NOT NULL DEFAULT 0
    CHECK (progress_percent BETWEEN 0 AND 100),
  options JSONB NOT NULL DEFAULT '{}'::jsonb CHECK (jsonb_typeof(options) = 'object'),
  result JSONB CHECK (result IS NULL OR jsonb_typeof(result) = 'object'),
  error_message TEXT CHECK (error_message IS NULL OR length(error_message) <= 2000),
  requested_by TEXT,
  started_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  completed_at TIMESTAMPTZ,
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  PRIMARY KEY (tenant_id, job_id),
  CONSTRAINT student_import_jobs_processed_le_total_ck
    CHECK (processed_rows <= total_rows),
  CONSTRAINT student_import_jobs_terminal_ck
    CHECK (
      (status IN ('completed', 'failed')) = (completed_at IS NOT NULL)
    ),
  CONSTRAINT student_import_jobs_result_ck
    CHECK (status <> 'completed' OR result IS NOT NULL),
  CONSTRAINT student_import_jobs_error_ck
    CHECK (status <> 'failed' OR error_message IS NOT NULL)
);

-- Recent jobs per tenant (admin list / stuck-job sweep).
CREATE INDEX IF NOT EXISTS student_import_jobs_tenant_status_idx
  ON student_import_jobs (tenant_id, status, updated_at DESC);

ALTER TABLE student_import_jobs ENABLE ROW LEVEL SECURITY;
ALTER TABLE student_import_jobs FORCE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS tenant_isolation ON student_import_jobs;
CREATE POLICY tenant_isolation ON student_import_jobs
  FOR ALL
  USING (tenant_id::text = NULLIF(current_setting('app.tenant_id', true), ''))
  WITH CHECK (tenant_id::text = NULLIF(current_setting('app.tenant_id', true), ''));

COMMENT ON TABLE student_import_jobs IS
  'PRC-H092 durable student import progress/result; poll by (tenant_id, job_id) from any instance.';

DO $$
BEGIN
  IF EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'proctira_app') THEN
    GRANT SELECT, INSERT, UPDATE, DELETE ON TABLE student_import_jobs TO proctira_app;
  END IF;
END $$;
