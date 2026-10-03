-- PRC-H092 — persisted student bulk-import progress, keyed by (tenant_id, job_id).
--
-- Async / >1000-row imports are processed by a queue consumer that may run in another
-- gateway instance; progress used to live in a per-process Map, so a poll that landed on a
-- different instance returned 404. PgImportProgressStore reads/writes this table under RLS.
--
-- Additive / idempotent. RLS ENABLE + FORCE with the standard tenant_isolation policy.
-- Needs DB review.

CREATE TABLE IF NOT EXISTS student_import_jobs (
  tenant_id UUID NOT NULL REFERENCES tenants(id),
  job_id UUID NOT NULL,
  status TEXT NOT NULL,
  total_rows INTEGER NOT NULL DEFAULT 0,
  processed_rows INTEGER NOT NULL DEFAULT 0,
  progress_percent INTEGER NOT NULL DEFAULT 0,
  result JSONB,
  error_message TEXT,
  started_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  completed_at TIMESTAMPTZ,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  PRIMARY KEY (tenant_id, job_id)
);

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint
     WHERE conname = 'student_import_jobs_status_check'
       AND conrelid = 'student_import_jobs'::regclass
  ) THEN
    ALTER TABLE student_import_jobs
      ADD CONSTRAINT student_import_jobs_status_check
      CHECK (status IN ('queued', 'processing', 'completed', 'failed')) NOT VALID;
  END IF;
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint
     WHERE conname = 'student_import_jobs_progress_check'
       AND conrelid = 'student_import_jobs'::regclass
  ) THEN
    ALTER TABLE student_import_jobs
      ADD CONSTRAINT student_import_jobs_progress_check
      CHECK (progress_percent BETWEEN 0 AND 100 AND total_rows >= 0 AND processed_rows >= 0)
      NOT VALID;
  END IF;
END $$;

ALTER TABLE student_import_jobs VALIDATE CONSTRAINT student_import_jobs_status_check;
ALTER TABLE student_import_jobs VALIDATE CONSTRAINT student_import_jobs_progress_check;

CREATE INDEX IF NOT EXISTS idx_student_import_jobs_tenant_updated
  ON student_import_jobs (tenant_id, updated_at DESC);

ALTER TABLE student_import_jobs ENABLE ROW LEVEL SECURITY;
ALTER TABLE student_import_jobs FORCE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS tenant_isolation ON student_import_jobs;
CREATE POLICY tenant_isolation ON student_import_jobs
  FOR ALL
  USING (tenant_id::text = NULLIF(current_setting('app.tenant_id', true), ''))
  WITH CHECK (tenant_id::text = NULLIF(current_setting('app.tenant_id', true), ''));

DO $$
BEGIN
  IF EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'proctira_app') THEN
    GRANT SELECT, INSERT, UPDATE, DELETE ON student_import_jobs TO proctira_app;
  END IF;
END $$;

INSERT INTO schema_migrations (filename)
VALUES ('152_student_import_jobs.sql')
ON CONFLICT (filename) DO NOTHING;
