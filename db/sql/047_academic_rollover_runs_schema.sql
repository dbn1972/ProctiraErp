-- World-class year rollover run ledger (audit + idempotency).
CREATE TABLE IF NOT EXISTS academic_rollover_runs (
  id UUID PRIMARY KEY,
  tenant_id UUID NOT NULL,
  source_period_id UUID NOT NULL,
  target_period_id UUID NOT NULL,
  actor_id TEXT NOT NULL,
  dry_run BOOLEAN NOT NULL DEFAULT false,
  idempotency_key TEXT,
  request JSONB NOT NULL DEFAULT '{}'::jsonb,
  summary JSONB NOT NULL DEFAULT '{}'::jsonb,
  status TEXT NOT NULL CHECK (status IN ('dry_run', 'completed', 'failed')),
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE UNIQUE INDEX IF NOT EXISTS academic_rollover_runs_idem_uidx
  ON academic_rollover_runs (tenant_id, idempotency_key)
  WHERE idempotency_key IS NOT NULL;
CREATE INDEX IF NOT EXISTS academic_rollover_runs_tenant_idx
  ON academic_rollover_runs (tenant_id, created_at DESC);

ALTER TABLE academic_rollover_runs ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS academic_rollover_runs_tenant ON academic_rollover_runs;
CREATE POLICY academic_rollover_runs_tenant ON academic_rollover_runs
  USING (tenant_id = nullif(current_setting('app.tenant_id', true), '')::uuid)
  WITH CHECK (tenant_id = nullif(current_setting('app.tenant_id', true), '')::uuid);

-- LMS modules (Canvas-class sequencing)
CREATE TABLE IF NOT EXISTS lms_modules (
  id UUID PRIMARY KEY,
  tenant_id UUID NOT NULL,
  institution_id UUID,
  board_id UUID,
  academic_period_id UUID,
  class_key TEXT,
  title TEXT NOT NULL,
  position INTEGER NOT NULL DEFAULT 0,
  published BOOLEAN NOT NULL DEFAULT false,
  created_by TEXT,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS lms_modules_tenant_idx ON lms_modules (tenant_id, class_key);

CREATE TABLE IF NOT EXISTS lms_module_items (
  id UUID PRIMARY KEY,
  tenant_id UUID NOT NULL,
  module_id UUID NOT NULL REFERENCES lms_modules(id) ON DELETE CASCADE,
  item_type TEXT NOT NULL CHECK (item_type IN ('assignment', 'content', 'discussion', 'url')),
  item_id UUID,
  title TEXT NOT NULL,
  position INTEGER NOT NULL DEFAULT 0,
  required BOOLEAN NOT NULL DEFAULT false,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS lms_module_items_module_idx ON lms_module_items (tenant_id, module_id, position);

ALTER TABLE lms_modules ENABLE ROW LEVEL SECURITY;
ALTER TABLE lms_module_items ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS lms_modules_tenant ON lms_modules;
CREATE POLICY lms_modules_tenant ON lms_modules
  USING (tenant_id = nullif(current_setting('app.tenant_id', true), '')::uuid)
  WITH CHECK (tenant_id = nullif(current_setting('app.tenant_id', true), '')::uuid);
DROP POLICY IF EXISTS lms_module_items_tenant ON lms_module_items;
CREATE POLICY lms_module_items_tenant ON lms_module_items
  USING (tenant_id = nullif(current_setting('app.tenant_id', true), '')::uuid)
  WITH CHECK (tenant_id = nullif(current_setting('app.tenant_id', true), '')::uuid);


-- Period key on assignments for world-class year rollover
ALTER TABLE lms_assignments
  ADD COLUMN IF NOT EXISTS academic_period_id UUID;
CREATE INDEX IF NOT EXISTS lms_assignments_tenant_period_idx
  ON lms_assignments (tenant_id, academic_period_id);
