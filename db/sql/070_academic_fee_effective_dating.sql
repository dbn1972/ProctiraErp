-- W1-DATA-07 (foundation): effective dating for academic periods and fee
-- structures, plus durable payroll export artifacts on staff_payroll_runs.
-- Additive migration — applied after 069 via tools/scripts/apply-sql.sh.
--
-- COMPLETE mutability / reverse-replace hardening lives in
-- 083_w1_data_07_append_only_versions.sql (append-only versions + payroll
-- immutability). Do not assume 070 alone closes W1-DATA-07.
--
-- academic_periods already carry start_date/end_date (the academic window).
-- valid_from/valid_to mirror those dates for as-of reporting (INSERT sync;
-- 076 makes subsequent date mutation illegal).
--
-- fee_structures gain first-class valid_from/valid_to (open-ended when
-- valid_to IS NULL). Tenant RLS unchanged; indexes support as-of filters.
--
-- Each section is gated on table existence so domain ensureSchema helpers
-- (fees / staff HR) can apply this file independently without failing when
-- a sibling domain table is not yet present.

-- ---------------------------------------------------------------------------
-- academic_periods
-- ---------------------------------------------------------------------------
DO $$
BEGIN
  IF to_regclass('public.academic_periods') IS NULL THEN
    RETURN;
  END IF;

  ALTER TABLE academic_periods ADD COLUMN IF NOT EXISTS valid_from DATE;
  ALTER TABLE academic_periods ADD COLUMN IF NOT EXISTS valid_to DATE;

  UPDATE academic_periods SET valid_from = start_date WHERE valid_from IS NULL;
  UPDATE academic_periods SET valid_to = end_date WHERE valid_to IS NULL;

  ALTER TABLE academic_periods ALTER COLUMN valid_from SET NOT NULL;
  ALTER TABLE academic_periods ALTER COLUMN valid_to SET NOT NULL;

  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint WHERE conname = 'academic_periods_valid_range_chk'
  ) THEN
    ALTER TABLE academic_periods
      ADD CONSTRAINT academic_periods_valid_range_chk
      CHECK (valid_to >= valid_from);
  END IF;

  CREATE INDEX IF NOT EXISTS academic_periods_tenant_effective_idx
    ON academic_periods (tenant_id, valid_from, valid_to)
    WHERE deleted_at IS NULL;
END $$;

CREATE OR REPLACE FUNCTION academic_periods_sync_effective_dates()
RETURNS TRIGGER AS $$
BEGIN
  NEW.valid_from := NEW.start_date;
  NEW.valid_to := NEW.end_date;
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
    BEFORE INSERT OR UPDATE OF start_date, end_date ON academic_periods
    FOR EACH ROW
    EXECUTE FUNCTION academic_periods_sync_effective_dates();
END $$;

-- ---------------------------------------------------------------------------
-- fee_structures
-- ---------------------------------------------------------------------------
DO $$
BEGIN
  IF to_regclass('public.fee_structures') IS NULL THEN
    RETURN;
  END IF;

  ALTER TABLE fee_structures ADD COLUMN IF NOT EXISTS valid_from DATE;
  ALTER TABLE fee_structures ADD COLUMN IF NOT EXISTS valid_to DATE;

  UPDATE fee_structures
  SET valid_from = COALESCE(valid_from, created_at::date, CURRENT_DATE)
  WHERE valid_from IS NULL;

  ALTER TABLE fee_structures ALTER COLUMN valid_from SET NOT NULL;
  ALTER TABLE fee_structures ALTER COLUMN valid_from SET DEFAULT CURRENT_DATE;

  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint WHERE conname = 'fee_structures_valid_range_chk'
  ) THEN
    ALTER TABLE fee_structures
      ADD CONSTRAINT fee_structures_valid_range_chk
      CHECK (valid_to IS NULL OR valid_to >= valid_from);
  END IF;

  CREATE INDEX IF NOT EXISTS fee_structures_tenant_effective_idx
    ON fee_structures (tenant_id, valid_from, valid_to)
    WHERE status = 'active';
END $$;

-- ---------------------------------------------------------------------------
-- staff_payroll_runs — durable export artifacts for StaffHrService
-- ---------------------------------------------------------------------------
DO $$
BEGIN
  IF to_regclass('public.staff_payroll_runs') IS NULL THEN
    RETURN;
  END IF;

  ALTER TABLE staff_payroll_runs ADD COLUMN IF NOT EXISTS csv_artifact TEXT;
  ALTER TABLE staff_payroll_runs ADD COLUMN IF NOT EXISTS trial_balance_json JSONB;
  ALTER TABLE staff_payroll_runs ADD COLUMN IF NOT EXISTS lines_json JSONB;

  COMMENT ON COLUMN staff_payroll_runs.csv_artifact IS
    'CSV body for idempotent payroll re-export (W1-DATA-07).';
END $$;

INSERT INTO schema_migrations (filename)
VALUES ('070_academic_fee_effective_dating.sql')
ON CONFLICT (filename) DO NOTHING;
