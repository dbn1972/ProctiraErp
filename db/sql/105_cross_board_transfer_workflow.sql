-- Cross-board transfer approval workflow.
--
-- transfer_records (021) stored a completed move only. This migration adds
-- the approval state, an append-only decision history, and tenant-scoped
-- grade equivalency between boards.
--
-- Online-safe (W1-DATA-17): indexes on the existing transfer_records table
-- are CREATE INDEX CONCURRENTLY, so apply-sql.sh runs this file
-- statement-by-statement. CHECK constraints are attached NOT VALID and then
-- validated with FORCE ROW LEVEL SECURITY lifted for the scan and restored
-- in the same DO block (see 098 / 103). Every statement is idempotent so a
-- crash between statement commit and phase-row insert can re-run it.
-- Existing completed rows keep workflow_status COMPLETED because they already
-- have a destination enrollment (the column default).

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

-- A CONCURRENTLY build that is interrupted leaves an INVALID index behind.
-- IF NOT EXISTS would then skip it forever, so drop any invalid leftover
-- before rebuilding. A plain DROP (not CONCURRENTLY) is required: DROP INDEX
-- CONCURRENTLY cannot run inside a DO block. The index being dropped is
-- INVALID, so the planner is not using it.
DO $drop_invalid_transfer_id_tenant_uidx$
BEGIN
  IF EXISTS (
    SELECT 1
      FROM pg_class c
      JOIN pg_namespace n ON n.oid = c.relnamespace
      JOIN pg_index i ON i.indexrelid = c.oid
     WHERE n.nspname = 'public'
       AND c.relname = 'transfer_records_id_tenant_uidx'
       AND NOT i.indisvalid
  ) THEN
    RAISE NOTICE 'dropping invalid transfer_records_id_tenant_uidx before rebuild';
    EXECUTE 'DROP INDEX IF EXISTS public.transfer_records_id_tenant_uidx';
  END IF;
END
$drop_invalid_transfer_id_tenant_uidx$;

-- Composite uniqueness is required by the approval-event FK below.
CREATE UNIQUE INDEX CONCURRENTLY IF NOT EXISTS transfer_records_id_tenant_uidx
  ON transfer_records (id, tenant_id);

DO $drop_invalid_transfer_status_idx$
BEGIN
  IF EXISTS (
    SELECT 1
      FROM pg_class c
      JOIN pg_namespace n ON n.oid = c.relnamespace
      JOIN pg_index i ON i.indexrelid = c.oid
     WHERE n.nspname = 'public'
       AND c.relname = 'transfer_records_tenant_status_idx'
       AND NOT i.indisvalid
  ) THEN
    RAISE NOTICE 'dropping invalid transfer_records_tenant_status_idx before rebuild';
    EXECUTE 'DROP INDEX IF EXISTS public.transfer_records_tenant_status_idx';
  END IF;
END
$drop_invalid_transfer_status_idx$;

CREATE INDEX CONCURRENTLY IF NOT EXISTS transfer_records_tenant_status_idx
  ON transfer_records (tenant_id, workflow_status, updated_at DESC);

DO $assert_transfer_record_indexes$
BEGIN
  IF NOT EXISTS (
    SELECT 1
      FROM pg_class c
      JOIN pg_namespace n ON n.oid = c.relnamespace
      JOIN pg_index i ON i.indexrelid = c.oid
     WHERE n.nspname = 'public'
       AND c.relname = 'transfer_records_id_tenant_uidx'
       AND i.indisvalid
       AND i.indisunique
  ) THEN
    RAISE EXCEPTION 'transfer_records_id_tenant_uidx missing or INVALID';
  END IF;
  IF NOT EXISTS (
    SELECT 1
      FROM pg_class c
      JOIN pg_namespace n ON n.oid = c.relnamespace
      JOIN pg_index i ON i.indexrelid = c.oid
     WHERE n.nspname = 'public'
       AND c.relname = 'transfer_records_tenant_status_idx'
       AND i.indisvalid
  ) THEN
    RAISE EXCEPTION 'transfer_records_tenant_status_idx missing or INVALID';
  END IF;
END
$assert_transfer_record_indexes$;

ALTER TABLE transfer_records
  DROP CONSTRAINT IF EXISTS transfer_records_workflow_status_check;

ALTER TABLE transfer_records
  ADD CONSTRAINT transfer_records_workflow_status_check
  CHECK (workflow_status IN (
    'DRAFT', 'SUBMITTED', 'UNDER_REVIEW', 'APPROVED', 'REJECTED', 'COMPLETED', 'CANCELLED'
  )) NOT VALID;

ALTER TABLE transfer_records
  DROP CONSTRAINT IF EXISTS transfer_records_completed_enrollment_chk;

ALTER TABLE transfer_records
  ADD CONSTRAINT transfer_records_completed_enrollment_chk
  CHECK (workflow_status <> 'COMPLETED' OR destination_enrollment_id IS NOT NULL) NOT VALID;

-- FORCE ROW LEVEL SECURITY applies the tenant policy to the table owner.
-- A migration session has no app.tenant_id, so VALIDATE under FORCE sees zero
-- rows and marks the constraint valid without reading them. Lift FORCE for
-- the scan and restore it in the same DO block so a failure cannot leave the
-- table unforced.
DO $validate_transfer_record_checks$
DECLARE
  was_forced boolean;
BEGIN
  SELECT relforcerowsecurity
    INTO was_forced
    FROM pg_class
   WHERE oid = 'public.transfer_records'::regclass;

  IF was_forced THEN
    ALTER TABLE transfer_records NO FORCE ROW LEVEL SECURITY;
  END IF;

  ALTER TABLE transfer_records VALIDATE CONSTRAINT transfer_records_workflow_status_check;
  ALTER TABLE transfer_records VALIDATE CONSTRAINT transfer_records_completed_enrollment_chk;

  IF was_forced THEN
    ALTER TABLE transfer_records FORCE ROW LEVEL SECURITY;
  END IF;
END
$validate_transfer_record_checks$;

CREATE TABLE IF NOT EXISTS transfer_approval_events (
  id            UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  tenant_id     UUID NOT NULL REFERENCES tenants (id),
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
  tenant_id          UUID NOT NULL REFERENCES tenants (id),
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

-- CREATE TABLE IF NOT EXISTS does not add a column FK when the table already
-- exists from a resumed phase. Attach tenant_id → tenants(id) if it is missing
-- (W1-DATA-06). NOT VALID, then VALIDATE with FORCE lifted.
DO $transfer_workflow_tenant_fks$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint
    WHERE conrelid = 'public.transfer_approval_events'::regclass
      AND conname = 'transfer_approval_events_tenant_id_fkey'
  ) THEN
    ALTER TABLE transfer_approval_events
      ADD CONSTRAINT transfer_approval_events_tenant_id_fkey
      FOREIGN KEY (tenant_id) REFERENCES tenants (id) NOT VALID;
  END IF;

  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint
    WHERE conrelid = 'public.grade_equivalency_rules'::regclass
      AND conname = 'grade_equivalency_rules_tenant_id_fkey'
  ) THEN
    ALTER TABLE grade_equivalency_rules
      ADD CONSTRAINT grade_equivalency_rules_tenant_id_fkey
      FOREIGN KEY (tenant_id) REFERENCES tenants (id) NOT VALID;
  END IF;
END
$transfer_workflow_tenant_fks$;

DO $validate_transfer_workflow_tenant_fks$
DECLARE
  events_forced boolean;
  rules_forced boolean;
BEGIN
  SELECT relforcerowsecurity INTO events_forced
    FROM pg_class WHERE oid = 'public.transfer_approval_events'::regclass;
  SELECT relforcerowsecurity INTO rules_forced
    FROM pg_class WHERE oid = 'public.grade_equivalency_rules'::regclass;

  IF events_forced THEN
    ALTER TABLE transfer_approval_events NO FORCE ROW LEVEL SECURITY;
  END IF;
  IF rules_forced THEN
    ALTER TABLE grade_equivalency_rules NO FORCE ROW LEVEL SECURITY;
  END IF;

  ALTER TABLE transfer_approval_events
    VALIDATE CONSTRAINT transfer_approval_events_tenant_id_fkey;
  ALTER TABLE grade_equivalency_rules
    VALIDATE CONSTRAINT grade_equivalency_rules_tenant_id_fkey;

  IF events_forced THEN
    ALTER TABLE transfer_approval_events FORCE ROW LEVEL SECURITY;
  END IF;
  IF rules_forced THEN
    ALTER TABLE grade_equivalency_rules FORCE ROW LEVEL SECURITY;
  END IF;
END
$validate_transfer_workflow_tenant_fks$;

INSERT INTO schema_migrations (filename)
VALUES ('105_cross_board_transfer_workflow.sql')
ON CONFLICT (filename) DO NOTHING;
