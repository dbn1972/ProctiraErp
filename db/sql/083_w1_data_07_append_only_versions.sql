-- W1-DATA-07 COMPLETE: append-only effective versions + payroll reverse/replace.
-- Additive follow-up to 070_academic_fee_effective_dating.sql.
--
-- Remaining PARTIAL gaps closed here:
--   * Academic/fee date & amount columns stay mutable via UPDATE
--   * Monthly payroll exports overwritten with ON CONFLICT DO UPDATE
--
-- Done posture:
--   * Academic/fee reference rows use versioned, non-overlapping windows;
--     corrections INSERT a successor (and optionally close prior valid_to).
--   * Posted payroll runs are immutable; corrections INSERT a reversal then a
--     replacement posted run (no overwrite of posted money/artifact columns).
--
-- Sections gate on table existence so domain ensureSchema helpers can apply
-- this file independently.

-- ---------------------------------------------------------------------------
-- academic_periods — versioning + immutable dates + non-overlap
-- ---------------------------------------------------------------------------
DO $$
BEGIN
  IF to_regclass('public.academic_periods') IS NULL THEN
    RETURN;
  END IF;

  ALTER TABLE academic_periods ADD COLUMN IF NOT EXISTS version INTEGER NOT NULL DEFAULT 1;
  ALTER TABLE academic_periods ADD COLUMN IF NOT EXISTS supersedes_id UUID;

  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint WHERE conname = 'academic_periods_supersedes_id_fkey'
  ) THEN
    ALTER TABLE academic_periods
      ADD CONSTRAINT academic_periods_supersedes_id_fkey
      FOREIGN KEY (supersedes_id) REFERENCES academic_periods(id);
  END IF;

  -- Allow multiple versions of the same code (append-only succession).
  ALTER TABLE academic_periods DROP CONSTRAINT IF EXISTS academic_periods_tenant_id_code_key;
  DROP INDEX IF EXISTS academic_periods_tenant_id_code_key;

  CREATE UNIQUE INDEX IF NOT EXISTS academic_periods_tenant_code_version_uidx
    ON academic_periods (tenant_id, code, version);
END $$;

-- INSERT still mirrors start/end onto valid_*; UPDATE of dates is forbidden below.
CREATE OR REPLACE FUNCTION academic_periods_sync_effective_dates()
RETURNS TRIGGER AS $$
BEGIN
  IF TG_OP = 'INSERT' THEN
    NEW.valid_from := COALESCE(NEW.valid_from, NEW.start_date);
    NEW.valid_to := COALESCE(NEW.valid_to, NEW.end_date);
  END IF;
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

DO $$
BEGIN
  IF to_regclass('public.academic_periods') IS NULL THEN
    RETURN;
  END IF;
  DROP TRIGGER IF EXISTS academic_periods_sync_effective_dates_trg ON academic_periods;
  CREATE TRIGGER academic_periods_sync_effective_dates_trg
    BEFORE INSERT ON academic_periods
    FOR EACH ROW
    EXECUTE FUNCTION academic_periods_sync_effective_dates();
END $$;

CREATE OR REPLACE FUNCTION academic_periods_dates_immutable()
RETURNS TRIGGER AS $$
BEGIN
  IF NEW.start_date IS DISTINCT FROM OLD.start_date
     OR NEW.end_date IS DISTINCT FROM OLD.end_date
     OR NEW.valid_from IS DISTINCT FROM OLD.valid_from
     OR NEW.valid_to IS DISTINCT FROM OLD.valid_to
     OR NEW.version IS DISTINCT FROM OLD.version
     OR NEW.supersedes_id IS DISTINCT FROM OLD.supersedes_id
     OR NEW.code IS DISTINCT FROM OLD.code THEN
    RAISE EXCEPTION
      'academic_periods effective dates/code/version are immutable; insert a non-overlapping successor version'
      USING ERRCODE = 'integrity_constraint_violation';
  END IF;
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

CREATE OR REPLACE FUNCTION academic_periods_reject_overlap()
RETURNS TRIGGER AS $$
DECLARE
  conflict_id UUID;
BEGIN
  IF NEW.deleted_at IS NOT NULL THEN
    RETURN NEW;
  END IF;
  SELECT id INTO conflict_id
  FROM academic_periods ap
  WHERE ap.tenant_id = NEW.tenant_id
    AND ap.code = NEW.code
    AND ap.deleted_at IS NULL
    AND ap.id IS DISTINCT FROM NEW.id
    AND daterange(ap.valid_from, ap.valid_to, '[]') &&
        daterange(NEW.valid_from, NEW.valid_to, '[]')
  LIMIT 1;
  IF conflict_id IS NOT NULL THEN
    RAISE EXCEPTION
      'academic_periods version overlap for code % (conflicts with %)', NEW.code, conflict_id
      USING ERRCODE = 'exclusion_violation';
  END IF;
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

DO $$
BEGIN
  IF to_regclass('public.academic_periods') IS NULL THEN
    RETURN;
  END IF;

  DROP TRIGGER IF EXISTS trg_academic_periods_dates_immutable ON academic_periods;
  CREATE TRIGGER trg_academic_periods_dates_immutable
    BEFORE UPDATE ON academic_periods
    FOR EACH ROW
    EXECUTE FUNCTION academic_periods_dates_immutable();

  DROP TRIGGER IF EXISTS trg_academic_periods_reject_overlap ON academic_periods;
  CREATE TRIGGER trg_academic_periods_reject_overlap
    BEFORE INSERT OR UPDATE OF valid_from, valid_to, deleted_at, code ON academic_periods
    FOR EACH ROW
    EXECUTE FUNCTION academic_periods_reject_overlap();
END $$;

-- ---------------------------------------------------------------------------
-- fee_structures — versioning + immutable money/window + close-only valid_to
-- ---------------------------------------------------------------------------
DO $$
BEGIN
  IF to_regclass('public.fee_structures') IS NULL THEN
    RETURN;
  END IF;

  ALTER TABLE fee_structures ADD COLUMN IF NOT EXISTS version INTEGER NOT NULL DEFAULT 1;
  ALTER TABLE fee_structures ADD COLUMN IF NOT EXISTS supersedes_id UUID;

  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint WHERE conname = 'fee_structures_supersedes_id_fkey'
  ) THEN
    ALTER TABLE fee_structures
      ADD CONSTRAINT fee_structures_supersedes_id_fkey
      FOREIGN KEY (supersedes_id) REFERENCES fee_structures(id);
  END IF;

  ALTER TABLE fee_structures DROP CONSTRAINT IF EXISTS fee_structures_tenant_id_code_key;
  DROP INDEX IF EXISTS fee_structures_tenant_id_code_key;

  CREATE UNIQUE INDEX IF NOT EXISTS fee_structures_tenant_code_version_uidx
    ON fee_structures (tenant_id, code, version);
END $$;

CREATE OR REPLACE FUNCTION fee_structures_effective_immutable()
RETURNS TRIGGER AS $$
BEGIN
  -- Money + open window start + identity are append-only.
  IF NEW.amount_cents IS DISTINCT FROM OLD.amount_cents
     OR NEW.valid_from IS DISTINCT FROM OLD.valid_from
     OR NEW.version IS DISTINCT FROM OLD.version
     OR NEW.supersedes_id IS DISTINCT FROM OLD.supersedes_id
     OR NEW.code IS DISTINCT FROM OLD.code
     OR NEW.category IS DISTINCT FROM OLD.category
     OR NEW.currency IS DISTINCT FROM OLD.currency THEN
    RAISE EXCEPTION
      'fee_structures amount/identity/valid_from are immutable; insert a non-overlapping successor version'
      USING ERRCODE = 'integrity_constraint_violation';
  END IF;

  -- valid_to may only close or narrow (never reopen / extend).
  IF NEW.valid_to IS DISTINCT FROM OLD.valid_to THEN
    IF OLD.valid_to IS NOT NULL AND NEW.valid_to IS NULL THEN
      RAISE EXCEPTION
        'fee_structures valid_to cannot be reopened once closed; insert a successor version'
        USING ERRCODE = 'integrity_constraint_violation';
    END IF;
    IF OLD.valid_to IS NOT NULL AND NEW.valid_to > OLD.valid_to THEN
      RAISE EXCEPTION
        'fee_structures valid_to can only narrow; insert a successor version to extend'
        USING ERRCODE = 'integrity_constraint_violation';
    END IF;
    IF NEW.valid_to IS NOT NULL AND NEW.valid_to < NEW.valid_from THEN
      RAISE EXCEPTION
        'fee_structures valid_to must be on or after valid_from'
        USING ERRCODE = 'check_violation';
    END IF;
  END IF;

  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

CREATE OR REPLACE FUNCTION fee_structures_reject_overlap()
RETURNS TRIGGER AS $$
DECLARE
  conflict_id UUID;
  new_to DATE;
BEGIN
  IF NEW.status = 'archived' THEN
    RETURN NEW;
  END IF;
  new_to := COALESCE(NEW.valid_to, DATE '9999-12-31');
  SELECT id INTO conflict_id
  FROM fee_structures fs
  WHERE fs.tenant_id = NEW.tenant_id
    AND fs.code = NEW.code
    AND fs.status = 'active'
    AND fs.id IS DISTINCT FROM NEW.id
    AND daterange(fs.valid_from, COALESCE(fs.valid_to, DATE '9999-12-31'), '[]') &&
        daterange(NEW.valid_from, new_to, '[]')
  LIMIT 1;
  IF conflict_id IS NOT NULL THEN
    RAISE EXCEPTION
      'fee_structures version overlap for code % (conflicts with %)', NEW.code, conflict_id
      USING ERRCODE = 'exclusion_violation';
  END IF;
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

DO $$
BEGIN
  IF to_regclass('public.fee_structures') IS NULL THEN
    RETURN;
  END IF;

  DROP TRIGGER IF EXISTS trg_fee_structures_effective_immutable ON fee_structures;
  CREATE TRIGGER trg_fee_structures_effective_immutable
    BEFORE UPDATE ON fee_structures
    FOR EACH ROW
    EXECUTE FUNCTION fee_structures_effective_immutable();

  DROP TRIGGER IF EXISTS trg_fee_structures_reject_overlap ON fee_structures;
  CREATE TRIGGER trg_fee_structures_reject_overlap
    BEFORE INSERT OR UPDATE OF valid_from, valid_to, status, code ON fee_structures
    FOR EACH ROW
    EXECUTE FUNCTION fee_structures_reject_overlap();
END $$;

-- ---------------------------------------------------------------------------
-- staff_payroll_runs — posted rows immutable; reverse + replace instead
-- ---------------------------------------------------------------------------
DO $$
BEGIN
  IF to_regclass('public.staff_payroll_runs') IS NULL THEN
    RETURN;
  END IF;

  ALTER TABLE staff_payroll_runs ADD COLUMN IF NOT EXISTS reverses_run_id UUID;
  ALTER TABLE staff_payroll_runs ADD COLUMN IF NOT EXISTS replaces_run_id UUID;

  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint WHERE conname = 'staff_payroll_runs_reverses_run_id_fkey'
  ) THEN
    ALTER TABLE staff_payroll_runs
      ADD CONSTRAINT staff_payroll_runs_reverses_run_id_fkey
      FOREIGN KEY (reverses_run_id) REFERENCES staff_payroll_runs(id);
  END IF;
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint WHERE conname = 'staff_payroll_runs_replaces_run_id_fkey'
  ) THEN
    ALTER TABLE staff_payroll_runs
      ADD CONSTRAINT staff_payroll_runs_replaces_run_id_fkey
      FOREIGN KEY (replaces_run_id) REFERENCES staff_payroll_runs(id);
  END IF;

  -- Expand status domain: posted | reversal
  ALTER TABLE staff_payroll_runs DROP CONSTRAINT IF EXISTS staff_payroll_runs_status_check;
  ALTER TABLE staff_payroll_runs
    ADD CONSTRAINT staff_payroll_runs_status_check
    CHECK (status IN ('posted', 'reversal'));

  -- Drop month uniqueness so reversal + replacement can coexist with the
  -- original posted row (posted rows are never UPDATEd).
  ALTER TABLE staff_payroll_runs DROP CONSTRAINT IF EXISTS staff_payroll_runs_tenant_id_month_key;
  DROP INDEX IF EXISTS staff_payroll_runs_tenant_id_month_key;

  -- Each posted run may be reversed at most once.
  CREATE UNIQUE INDEX IF NOT EXISTS staff_payroll_runs_reverses_once_uidx
    ON staff_payroll_runs (reverses_run_id)
    WHERE reverses_run_id IS NOT NULL;
END $$;

CREATE OR REPLACE FUNCTION staff_payroll_runs_posted_immutable()
RETURNS TRIGGER AS $$
BEGIN
  IF TG_OP = 'DELETE' THEN
    RAISE EXCEPTION 'staff_payroll_runs is append-only (DELETE rejected)'
      USING ERRCODE = 'integrity_constraint_violation';
  END IF;

  -- No mutation of posted money / export artifacts / identity.
  IF NEW.tenant_id IS DISTINCT FROM OLD.tenant_id
     OR NEW.month IS DISTINCT FROM OLD.month
     OR NEW.status IS DISTINCT FROM OLD.status
     OR NEW.gross_cents IS DISTINCT FROM OLD.gross_cents
     OR NEW.deductions_cents IS DISTINCT FROM OLD.deductions_cents
     OR NEW.net_cents IS DISTINCT FROM OLD.net_cents
     OR NEW.csv_artifact IS DISTINCT FROM OLD.csv_artifact
     OR NEW.trial_balance_json IS DISTINCT FROM OLD.trial_balance_json
     OR NEW.lines_json IS DISTINCT FROM OLD.lines_json
     OR NEW.reverses_run_id IS DISTINCT FROM OLD.reverses_run_id
     OR NEW.replaces_run_id IS DISTINCT FROM OLD.replaces_run_id
     OR NEW.posted_at IS DISTINCT FROM OLD.posted_at
     OR NEW.created_at IS DISTINCT FROM OLD.created_at THEN
    RAISE EXCEPTION
      'staff_payroll_runs posted rows are immutable; insert a reversal then a replacement run'
      USING ERRCODE = 'integrity_constraint_violation';
  END IF;
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

DO $$
BEGIN
  IF to_regclass('public.staff_payroll_runs') IS NULL THEN
    RETURN;
  END IF;

  DROP TRIGGER IF EXISTS trg_staff_payroll_runs_posted_immutable ON staff_payroll_runs;
  CREATE TRIGGER trg_staff_payroll_runs_posted_immutable
    BEFORE UPDATE OR DELETE ON staff_payroll_runs
    FOR EACH ROW
    EXECUTE FUNCTION staff_payroll_runs_posted_immutable();

  COMMENT ON COLUMN staff_payroll_runs.reverses_run_id IS
    'When status=reversal, the posted run this row reverses (W1-DATA-07).';
  COMMENT ON COLUMN staff_payroll_runs.replaces_run_id IS
    'When status=posted after a correction, the prior posted run this replaces (W1-DATA-07).';
END $$;

INSERT INTO schema_migrations (filename)
VALUES ('083_w1_data_07_append_only_versions.sql')
ON CONFLICT (filename) DO NOTHING;
