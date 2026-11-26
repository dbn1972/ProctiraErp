-- PRC-L292: transcripts sealed by 076's unkeyed backfill are marked
-- LEGACY_UNSIGNED; every new ISSUED transcript must be KMS-keyed.
--
-- 076 (checksum-locked) backfilled signature_hmac on old ISSUED rows with an
-- unkeyed sha256('w1-data-08-legacy-seal:v1:' || tenant || checksum || id).
-- Anyone can recompute that value, yet it satisfies
-- transcript_issuances_issued_authenticity_chk (64 hex chars), so a legacy
-- seal looks exactly like a real HMAC. Rows issued before the dedicated key
-- (076's "App HMAC reused JWT / board-export secrets") are not verifiable
-- under the dedicated key either.
--
-- Fix (forward migration; 069/076 stay as they are):
--   1. seal_status TEXT: 'KMS_HMAC' (HMAC-SHA256 under the dedicated
--      transcript key, provenance in metadata.signingKeyId / kmsKeyRef /
--      signatureAlg, written by GradebookService.issueTranscript since 076) or
--      'LEGACY_UNSIGNED' (anything else: 076's unkeyed backfill, or a seal
--      without dedicated-key provenance).
--   2. Backfill every ISSUED row once. transcript_issuances is append-only
--      (053 trigger), so, as in 076, the trigger is disabled for this
--      migrator UPDATE only, and FORCE ROW LEVEL SECURITY is lifted so the
--      owner sees every tenant's rows; both are restored in this transaction.
--      Only seal_status is written; checksum, signature and metadata are kept.
--   3. CHECK: an ISSUED row has a seal_status, and a KMS_HMAC row carries the
--      key provenance. Added NOT VALID, then VALIDATEd after the backfill.
--   4. The 069 BEFORE INSERT guard also requires seal_status = 'KMS_HMAC' on
--      a new ISSUED row, so LEGACY_UNSIGNED can only come from this backfill.
--
-- Not done here: re-signing legacy transcripts under KMS (a transcript is
-- append-only; a re-sign is a new issued version through the application with
-- the dedicated key), and third-party verification of the checksum (the
-- keyed HMAC is server-verifiable only).
--
-- Rollback (forward migration): drop the CHECK, restore 069's function body,
-- drop seal_status.
ALTER TABLE transcript_issuances ADD COLUMN IF NOT EXISTS seal_status TEXT;
COMMENT ON COLUMN transcript_issuances.seal_status IS
  'PRC-L292: KMS_HMAC (dedicated-key HMAC with provenance in metadata) or LEGACY_UNSIGNED '
  '(076 unkeyed backfill or no dedicated-key provenance; not a verifiable signature).';
ALTER TABLE transcript_issuances DROP CONSTRAINT IF EXISTS transcript_issuances_seal_status_chk;
ALTER TABLE transcript_issuances
  ADD CONSTRAINT transcript_issuances_seal_status_chk
  CHECK (
    (seal_status IS NULL OR seal_status IN ('KMS_HMAC', 'LEGACY_UNSIGNED'))
    AND (status <> 'ISSUED' OR seal_status IS NOT NULL)
    AND (
      seal_status IS DISTINCT FROM 'KMS_HMAC'
      OR (
        metadata ->> 'signatureAlg' = 'HMAC-SHA256'
        AND length(coalesce(metadata ->> 'signingKeyId', '')) > 0
        AND length(coalesce(metadata ->> 'kmsKeyRef', '')) > 0
        AND coalesce(metadata ->> 'legacyAuthenticitySeal', 'false') <> 'true'
      )
    )
  ) NOT VALID;
DO $l292$
DECLARE
  was_forced boolean;
BEGIN
  SELECT relforcerowsecurity INTO was_forced
    FROM pg_class WHERE oid = 'public.transcript_issuances'::regclass;
  IF was_forced THEN
    ALTER TABLE transcript_issuances NO FORCE ROW LEVEL SECURITY;
  END IF;
  ALTER TABLE transcript_issuances DISABLE TRIGGER trg_transcript_issuances_append_only;
  UPDATE transcript_issuances
     SET seal_status = CASE
           WHEN metadata ->> 'signatureAlg' = 'HMAC-SHA256'
            AND length(coalesce(metadata ->> 'signingKeyId', '')) > 0
            AND length(coalesce(metadata ->> 'kmsKeyRef', '')) > 0
            AND coalesce(metadata ->> 'legacyAuthenticitySeal', 'false') <> 'true'
           THEN 'KMS_HMAC'
           ELSE 'LEGACY_UNSIGNED'
         END
   WHERE status = 'ISSUED' AND seal_status IS NULL;
  ALTER TABLE transcript_issuances ENABLE TRIGGER trg_transcript_issuances_append_only;
  ALTER TABLE transcript_issuances VALIDATE CONSTRAINT transcript_issuances_seal_status_chk;
  IF was_forced THEN
    ALTER TABLE transcript_issuances FORCE ROW LEVEL SECURITY;
  END IF;
END
$l292$;
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
    -- PRC-L292: a new issuance is sealed with the dedicated KMS key; LEGACY_UNSIGNED
    -- exists only for rows classified by 329's backfill.
    IF NEW.seal_status IS DISTINCT FROM 'KMS_HMAC' THEN
      RAISE EXCEPTION
        'transcript_issuances ISSUED rows require seal_status KMS_HMAC (got %)',
        coalesce(NEW.seal_status, 'NULL')
        USING ERRCODE = 'integrity_constraint_violation';
    END IF;
  END IF;
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;
INSERT INTO schema_migrations (filename)
VALUES ('329_transcript_legacy_seal_status.sql')
ON CONFLICT (filename) DO NOTHING;
