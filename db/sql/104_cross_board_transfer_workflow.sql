-- Cross-board transfer approval workflow.
--
-- transfer_records (021) stored a completed move only. This migration adds
-- the approval state, an append-only decision history, and tenant-scoped
-- grade equivalency between boards. Idempotent. Existing completed rows
-- keep workflow_status COMPLETED because they already have a destination
-- enrollment.

ALTER TABLE transfer_records
  ADD COLUMN IF NOT EXISTS workflow_status TEXT NOT NULL DEFAULT 'COMPLETED';

ALTER TABLE transfer_records
  ADD COLUMN IF NOT EXISTS destination_grade_id UUID;

ALTER TABLE transfer_records
  ADD COLUMN IF NOT EXISTS destination_class_id UUID;

ALTER TABLE transfer_records
  ADD COLUMN IF NOT EXISTS academic_period_id UUID;

ALTER TABLE transfer_records
  ADD COLUMN IF NOT EXISTS requested_by TEXT;

ALTER TABLE transfer_records
  ADD COLUMN IF NOT EXISTS updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW();

ALTER TABLE transfer_records
  ALTER COLUMN destination_enrollment_id DROP NOT NULL;

ALTER TABLE transfer_records
  DROP CONSTRAINT IF EXISTS transfer_records_workflow_status_check;

ALTER TABLE transfer_records
  ADD CONSTRAINT transfer_records_workflow_status_check
  CHECK (workflow_status IN (
    'DRAFT', 'SUBMITTED', 'UNDER_REVIEW', 'APPROVED', 'REJECTED', 'COMPLETED', 'CANCELLED'
  ));

ALTER TABLE transfer_records
  DROP CONSTRAINT IF EXISTS transfer_records_completed_enrollment_chk;

ALTER TABLE transfer_records
  ADD CONSTRAINT transfer_records_completed_enrollment_chk
  CHECK (workflow_status <> 'COMPLETED' OR destination_enrollment_id IS NOT NULL);

CREATE INDEX IF NOT EXISTS transfer_records_tenant_status_idx
  ON transfer_records (tenant_id, workflow_status, updated_at DESC);

CREATE UNIQUE INDEX IF NOT EXISTS transfer_records_id_tenant_uidx
  ON transfer_records (id, tenant_id);

CREATE TABLE IF NOT EXISTS transfer_approval_events (
  id            UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  tenant_id     UUID NOT NULL,
  transfer_id   UUID NOT NULL,
  from_status   TEXT NOT NULL,
  to_status     TEXT NOT NULL,
  decision      TEXT NOT NULL CHECK (decision IN (
    'SUBMIT', 'START_REVIEW', 'APPROVE', 'REJECT', 'CANCEL', 'COMPLETE', 'COMMENT'
  )),
  actor_user_id TEXT NOT NULL,
  actor_role    TEXT NOT NULL,
  actor_name    TEXT NOT NULL,
  comment       TEXT,
  created_at    TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  CONSTRAINT transfer_approval_events_transfer_tenant_fkey
    FOREIGN KEY (transfer_id, tenant_id)
    REFERENCES transfer_records (id, tenant_id)
);

CREATE INDEX IF NOT EXISTS transfer_approval_events_tenant_transfer_idx
  ON transfer_approval_events (tenant_id, transfer_id, created_at ASC);

CREATE OR REPLACE FUNCTION transfer_approval_events_append_only()
RETURNS TRIGGER
LANGUAGE plpgsql
AS $$
BEGIN
  RAISE EXCEPTION 'transfer_approval_events is append-only (% rejected)', TG_OP;
END;
$$;

DROP TRIGGER IF EXISTS trg_transfer_approval_events_append_only ON transfer_approval_events;
CREATE TRIGGER trg_transfer_approval_events_append_only
  BEFORE UPDATE OR DELETE ON transfer_approval_events
  FOR EACH ROW EXECUTE FUNCTION transfer_approval_events_append_only();

-- Grade equivalency: source board + grade + subject → target board + grade + subject.
-- Marks: target = min(target_marks_max, source_marks * (target_marks_max / source_marks_max) * credit_factor).
-- mapping_status mapped = direct; bridge = provisional until a bridge exam; na = no credit transfer.
CREATE TABLE IF NOT EXISTS grade_equivalency_rules (
  id                 UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  tenant_id          UUID NOT NULL,
  source_board_id    UUID NOT NULL REFERENCES boards (id),
  target_board_id    UUID NOT NULL REFERENCES boards (id),
  source_grade_code  TEXT NOT NULL,
  target_grade_code  TEXT NOT NULL,
  source_subject     TEXT NOT NULL,
  target_subject     TEXT NOT NULL,
  source_marks_max   NUMERIC(8,2) NOT NULL DEFAULT 100,
  target_marks_max   NUMERIC(8,2) NOT NULL DEFAULT 100,
  credit_factor      NUMERIC(8,4) NOT NULL DEFAULT 1,
  mapping_status     TEXT NOT NULL CHECK (mapping_status IN ('mapped', 'bridge', 'na')),
  notes              TEXT,
  created_at         TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at         TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  CONSTRAINT grade_equivalency_rules_scales_chk CHECK (
    source_marks_max > 0 AND target_marks_max > 0 AND credit_factor >= 0
  ),
  CONSTRAINT grade_equivalency_rules_pair_uniq UNIQUE (
    tenant_id, source_board_id, target_board_id, source_grade_code, source_subject
  )
);

CREATE INDEX IF NOT EXISTS grade_equivalency_rules_lookup_idx
  ON grade_equivalency_rules (tenant_id, source_board_id, target_board_id, source_grade_code);

ALTER TABLE transfer_approval_events ENABLE ROW LEVEL SECURITY;
ALTER TABLE transfer_approval_events FORCE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS transfer_approval_events_tenant ON transfer_approval_events;
CREATE POLICY transfer_approval_events_tenant ON transfer_approval_events
  AS PERMISSIVE FOR ALL TO PUBLIC
  USING (tenant_id::text = app_tenant_id())
  WITH CHECK (tenant_id::text = app_tenant_id());

ALTER TABLE grade_equivalency_rules ENABLE ROW LEVEL SECURITY;
ALTER TABLE grade_equivalency_rules FORCE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS grade_equivalency_rules_tenant ON grade_equivalency_rules;
CREATE POLICY grade_equivalency_rules_tenant ON grade_equivalency_rules
  AS PERMISSIVE FOR ALL TO PUBLIC
  USING (tenant_id::text = app_tenant_id())
  WITH CHECK (tenant_id::text = app_tenant_id());

INSERT INTO schema_migrations (filename)
VALUES ('104_cross_board_transfer_workflow.sql')
ON CONFLICT (filename) DO NOTHING;
