-- Admissions public-context remediation (ADM-SEC-01 / ADM-CFG-01 /
-- ADM-DATA-01 / ADM-SUBMIT-01).
--
-- Forward-only expansion after 096:
--   * immutable, institution-owned published form configuration versions;
--   * exact configuration version/snapshot evidence on applications; and
--   * durable tenant-scoped submission-key uniqueness for concurrent retries.
--
-- The nullable application columns preserve legacy rows. New public writes are
-- fail-closed by repository validation plus the validated context CHECK/FK.
-- CREATE UNIQUE INDEX CONCURRENTLY keeps the existing application table online;
-- apply-sql.sh therefore executes this file through its resumable phase ledger.

CREATE TABLE IF NOT EXISTS admission_form_configurations (
  id UUID PRIMARY KEY,
  tenant_id UUID NOT NULL REFERENCES tenants(id),
  institution_id UUID NOT NULL REFERENCES institutions(id),
  version INTEGER NOT NULL CHECK (version >= 1),
  fields JSONB NOT NULL CHECK (jsonb_typeof(fields) = 'array'),
  published_at TIMESTAMPTZ NOT NULL,
  published_by UUID,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  CONSTRAINT admission_form_configurations_tenant_context_key
    UNIQUE (tenant_id, id, institution_id, version),
  CONSTRAINT admission_form_configurations_tenant_version_key
    UNIQUE (tenant_id, institution_id, version)
);

CREATE INDEX IF NOT EXISTS admission_form_configurations_tenant_latest_idx
  ON admission_form_configurations (tenant_id, institution_id, version DESC);

ALTER TABLE admission_form_configurations ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS tenant_isolation ON admission_form_configurations;
CREATE POLICY tenant_isolation ON admission_form_configurations
  FOR ALL
  USING (tenant_id::text = NULLIF(current_setting('app.tenant_id', true), ''))
  WITH CHECK (tenant_id::text = NULLIF(current_setting('app.tenant_id', true), ''));
ALTER TABLE admission_form_configurations FORCE ROW LEVEL SECURITY;

CREATE OR REPLACE FUNCTION admission_form_configurations_append_only()
RETURNS TRIGGER
LANGUAGE plpgsql
SET search_path = public
AS $$
BEGIN
  RAISE EXCEPTION 'admission_form_configurations is append-only (% rejected)', TG_OP
    USING ERRCODE = 'integrity_constraint_violation';
END;
$$;

DROP TRIGGER IF EXISTS trg_admission_form_configurations_append_only
  ON admission_form_configurations;
CREATE TRIGGER trg_admission_form_configurations_append_only
  BEFORE UPDATE OR DELETE ON admission_form_configurations
  FOR EACH ROW EXECUTE FUNCTION admission_form_configurations_append_only();

ALTER TABLE admission_applications
  ADD COLUMN IF NOT EXISTS form_configuration_id UUID,
  ADD COLUMN IF NOT EXISTS form_configuration_version INTEGER,
  ADD COLUMN IF NOT EXISTS form_configuration_snapshot JSONB,
  ADD COLUMN IF NOT EXISTS submission_key TEXT,
  ADD COLUMN IF NOT EXISTS submission_payload_hash TEXT;

CREATE UNIQUE INDEX CONCURRENTLY IF NOT EXISTS admission_applications_tenant_submission_key_uidx
  ON admission_applications (tenant_id, submission_key)
  WHERE submission_key IS NOT NULL;

DO $application_context_constraints$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint
    WHERE conrelid = 'public.admission_applications'::regclass
      AND conname = 'admission_applications_submission_context_check'
  ) THEN
    ALTER TABLE admission_applications
      ADD CONSTRAINT admission_applications_submission_context_check
      CHECK (
        submission_key IS NULL
        OR (
          char_length(submission_key) BETWEEN 8 AND 128
          AND submission_payload_hash ~ '^[0-9a-f]{64}$'
          AND form_configuration_id IS NOT NULL
          AND form_configuration_version >= 1
          AND jsonb_typeof(form_configuration_snapshot) = 'object'
        )
      ) NOT VALID;
  END IF;

  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint
    WHERE conrelid = 'public.admission_applications'::regclass
      AND conname = 'admission_applications_form_configuration_fkey'
  ) THEN
    ALTER TABLE admission_applications
      ADD CONSTRAINT admission_applications_form_configuration_fkey
      FOREIGN KEY (
        tenant_id,
        form_configuration_id,
        institution_id,
        form_configuration_version
      )
      REFERENCES admission_form_configurations (
        tenant_id,
        id,
        institution_id,
        version
      )
      NOT VALID;
  END IF;
END
$application_context_constraints$;

ALTER TABLE admission_applications
  VALIDATE CONSTRAINT admission_applications_submission_context_check;
ALTER TABLE admission_applications
  VALIDATE CONSTRAINT admission_applications_form_configuration_fkey;

REVOKE ALL ON admission_form_configurations FROM PUBLIC;

INSERT INTO schema_migrations (filename)
VALUES ('097_admissions_public_context.sql')
ON CONFLICT (filename) DO NOTHING;
