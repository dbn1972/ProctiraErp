-- PRC-H057: versioned, append-only examination result publications.
--
-- examination_publications keeps one mutable snapshot per examination, so a
-- republish after double-entry resolution or re-evaluation overwrote the
-- previous result with no history. Each publish now appends a row here with a
-- monotonically increasing version per (tenant, examination); the latest
-- version is the current result and earlier versions stay as evidence.
--
-- Companion Prisma migration 20261003_prc_h057_examination_candidate_optional_dimensions
-- makes examination_candidates.gender / area_id nullable (Prisma owns that table).
--
-- New, empty table: ordinary transactional DDL. Idempotent.
-- Immutability: BEFORE UPDATE OR DELETE trigger + append_only runtime class
-- (SELECT, INSERT). Corrections are a new version, never an edit.
-- Rollback: forward-only. Dropping the table loses publication history.

CREATE TABLE IF NOT EXISTS examination_publication_versions (
  tenant_id UUID NOT NULL REFERENCES tenants(id),
  examination_id UUID NOT NULL REFERENCES examinations(id),
  version INTEGER NOT NULL CHECK (version >= 1),
  reason TEXT NOT NULL
    CHECK (reason IN ('initial', 'double_entry_resolution', 're_evaluation', 'correction')),
  supersedes_version INTEGER,
  published_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  published_by TEXT,
  payload JSONB NOT NULL CHECK (jsonb_typeof(payload) = 'object'),
  payload_sha256 TEXT CHECK (payload_sha256 IS NULL OR payload_sha256 ~ '^[0-9a-f]{64}$'),
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  PRIMARY KEY (tenant_id, examination_id, version),
  CONSTRAINT examination_publication_versions_supersedes_ck
    CHECK (
      (version = 1 AND supersedes_version IS NULL)
      OR (version > 1 AND supersedes_version = version - 1)
    ),
  CONSTRAINT examination_publication_versions_supersedes_fk
    FOREIGN KEY (tenant_id, examination_id, supersedes_version)
    REFERENCES examination_publication_versions (tenant_id, examination_id, version)
);

CREATE INDEX IF NOT EXISTS examination_publication_versions_latest_idx
  ON examination_publication_versions (tenant_id, examination_id, version DESC);

CREATE OR REPLACE FUNCTION examination_publication_versions_immutable()
RETURNS trigger
LANGUAGE plpgsql
SET search_path = public, pg_temp
AS $fn$
BEGIN
  RAISE EXCEPTION 'examination_publication_versions is append-only (%): publish a new version instead',
    TG_OP
    USING ERRCODE = 'insufficient_privilege';
END
$fn$;

DROP TRIGGER IF EXISTS examination_publication_versions_immutable ON examination_publication_versions;
CREATE TRIGGER examination_publication_versions_immutable
  BEFORE UPDATE OR DELETE ON examination_publication_versions
  FOR EACH ROW EXECUTE FUNCTION examination_publication_versions_immutable();

ALTER TABLE examination_publication_versions ENABLE ROW LEVEL SECURITY;
ALTER TABLE examination_publication_versions FORCE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS tenant_isolation ON examination_publication_versions;
CREATE POLICY tenant_isolation ON examination_publication_versions
  FOR ALL
  USING (tenant_id::text = NULLIF(current_setting('app.tenant_id', true), ''))
  WITH CHECK (tenant_id::text = NULLIF(current_setting('app.tenant_id', true), ''));

COMMENT ON TABLE examination_publication_versions IS
  'PRC-H057 append-only result publication history; latest version per examination is current.';

DO $$
BEGIN
  IF EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'proctira_app') THEN
    REVOKE ALL ON TABLE examination_publication_versions FROM proctira_app;
    GRANT SELECT, INSERT ON TABLE examination_publication_versions TO proctira_app;
  END IF;
END $$;
