-- W1-DATA-08 (A3) — Immutability privilege hardening.
--
-- A1 (050) splits migrator/owner from proctira_app runtime role; A2 (051) FORCEs
-- RLS. Immutability still relied on append-only triggers the table owner could
-- drop, and transcript_issuances had no DB-level guard — proctira_app could
-- UPDATE/DELETE issued rows via its broad DML grant.
--
-- Posture after this file:
--   * transcript_issuances is append-only (issue = INSERT new version only)
--   * proctira_app REVOKE UPDATE/DELETE/TRUNCATE/TRIGGER on ledger/audit/transcript
--   * runtime role remains non-owner (cannot DROP triggers); defense in depth

-- Official transcripts: append-only at the database (G-303 / DEV_SIS_GRADEBOOK).
CREATE OR REPLACE FUNCTION transcript_issuances_append_only() RETURNS trigger AS $$
BEGIN
  RAISE EXCEPTION 'transcript_issuances is append-only (% rejected)', TG_OP
    USING ERRCODE = 'integrity_constraint_violation';
END;
$$ LANGUAGE plpgsql;

DROP TRIGGER IF EXISTS trg_transcript_issuances_append_only ON transcript_issuances;
CREATE TRIGGER trg_transcript_issuances_append_only
  BEFORE UPDATE OR DELETE ON transcript_issuances
  FOR EACH ROW EXECUTE FUNCTION transcript_issuances_append_only();

-- Narrow runtime DML on tables guarded by append-only triggers (050 grants ALL DML).
DO $$
DECLARE
  t TEXT;
BEGIN
  FOREACH t IN ARRAY ARRAY[
    'fee_ledger_entries',
    'audit_log_entries',
    'workflow_transition_audit',
    'transcript_issuances'
  ]
  LOOP
    EXECUTE format('REVOKE UPDATE, DELETE ON %I FROM proctira_app', t);
    EXECUTE format('REVOKE TRUNCATE ON %I FROM proctira_app', t);
    EXECUTE format('REVOKE TRIGGER ON %I FROM proctira_app', t);
  END LOOP;
END $$;

INSERT INTO schema_migrations (filename)
VALUES ('053_immutability_privileges.sql')
ON CONFLICT (filename) DO NOTHING;
