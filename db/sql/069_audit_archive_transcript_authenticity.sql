-- W1-DATA-08 residual — audit archive immutability + transcript authenticity.
--
-- Prior posture (053):
--   * audit_log_entries append-only (DELETE only under app.audit_archival='1')
--   * transcript_issuances UPDATE/DELETE blocked + REVOKE from proctira_app
--   * fee_ledger / workflow_transition_audit already append-only
--
-- Gaps closed here:
--   1. audit_log_archive had no mutate guard — archived rows could be UPDATEd/DELETEd
--      by any role with DML (including proctira_app via 050's broad grant).
--   2. ISSUED transcripts accepted NULL checksum_sha256 / no first-class signature;
--      authenticity lived only in app metadata.
--
-- Posture after this file:
--   * audit_log_archive is append-only (INSERT only; never UPDATE/DELETE)
--   * proctira_app REVOKE UPDATE/DELETE/TRUNCATE/TRIGGER on audit_log_archive
--   * transcript_issuances.signature_hmac column + INSERT guard requiring
--     checksum_sha256 + signature_hmac (64 hex) when status = 'ISSUED'
--   * existing append-only UPDATE/DELETE on transcript_issuances unchanged (053)

-- ---------------------------------------------------------------------------
-- 1. Audit archive — permanent append-only (no archival DELETE path)
-- ---------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION audit_log_archive_append_only()
RETURNS TRIGGER AS $$
BEGIN
  RAISE EXCEPTION 'audit_log_archive is append-only (% rejected)', TG_OP
    USING ERRCODE = 'integrity_constraint_violation';
END;
$$ LANGUAGE plpgsql;

DROP TRIGGER IF EXISTS trg_audit_log_archive_append_only ON audit_log_archive;
CREATE TRIGGER trg_audit_log_archive_append_only
  BEFORE UPDATE OR DELETE ON audit_log_archive
  FOR EACH ROW EXECUTE FUNCTION audit_log_archive_append_only();

DO $$
BEGIN
  IF EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'proctira_app') THEN
    REVOKE UPDATE, DELETE ON audit_log_archive FROM proctira_app;
    REVOKE TRUNCATE ON audit_log_archive FROM proctira_app;
    REVOKE TRIGGER ON audit_log_archive FROM proctira_app;
  END IF;
END $$;

-- ---------------------------------------------------------------------------
-- 2. Transcript authenticity — first-class HMAC + ISSUED insert enforcement
-- ---------------------------------------------------------------------------
ALTER TABLE transcript_issuances
  ADD COLUMN IF NOT EXISTS signature_hmac VARCHAR(64);

COMMENT ON COLUMN transcript_issuances.checksum_sha256 IS
  'SHA-256 hex digest of the issued transcript payload (required when status=ISSUED).';
COMMENT ON COLUMN transcript_issuances.signature_hmac IS
  'HMAC-SHA256 hex over transcript:<tenant_id>:<checksum> (required when status=ISSUED).';

CREATE OR REPLACE FUNCTION transcript_issuances_require_authenticity()
RETURNS TRIGGER AS $$
BEGIN
  IF NEW.status = 'ISSUED' THEN
    IF NEW.checksum_sha256 IS NULL
       OR NEW.checksum_sha256 !~ '^[a-f0-9]{64}$' THEN
      RAISE EXCEPTION
        'transcript_issuances ISSUED rows require checksum_sha256 (64 hex chars)'
        USING ERRCODE = 'integrity_constraint_violation';
    END IF;
    IF NEW.signature_hmac IS NULL
       OR NEW.signature_hmac !~ '^[a-f0-9]{64}$' THEN
      RAISE EXCEPTION
        'transcript_issuances ISSUED rows require signature_hmac (64 hex chars)'
        USING ERRCODE = 'integrity_constraint_violation';
    END IF;
  END IF;
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

DROP TRIGGER IF EXISTS trg_transcript_issuances_authenticity ON transcript_issuances;
CREATE TRIGGER trg_transcript_issuances_authenticity
  BEFORE INSERT ON transcript_issuances
  FOR EACH ROW EXECUTE FUNCTION transcript_issuances_require_authenticity();

-- Soft CHECK for new/rewritten rows; NOT VALID so pre-068 ISSUED rows without
-- signature_hmac (if any) do not block apply. New ISSUED inserts are enforced
-- by the trigger above regardless.
ALTER TABLE transcript_issuances
  DROP CONSTRAINT IF EXISTS transcript_issuances_issued_authenticity_chk;
ALTER TABLE transcript_issuances
  ADD CONSTRAINT transcript_issuances_issued_authenticity_chk
  CHECK (
    status <> 'ISSUED'
    OR (
      checksum_sha256 IS NOT NULL
      AND checksum_sha256 ~ '^[a-f0-9]{64}$'
      AND signature_hmac IS NOT NULL
      AND signature_hmac ~ '^[a-f0-9]{64}$'
    )
  ) NOT VALID;

INSERT INTO schema_migrations (filename)
VALUES ('069_audit_archive_transcript_authenticity.sql')
ON CONFLICT (filename) DO NOTHING;
