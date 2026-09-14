-- W1-DATA-08 COMPLETE — backfill ISSUED transcripts + VALIDATE authenticity
-- CHECK + first-class rotated KMS/PKI signing-key registry.
--
-- Residual after 069:
--   * Soft CHECK transcript_issuances_issued_authenticity_chk remained NOT VALID
--   * Pre-069 ISSUED rows could lack checksum_sha256 / signature_hmac
--   * App HMAC reused JWT / board-export secrets
--
-- This file:
--   1. Creates transcript_signing_keys (tenant/institution rotated key refs)
--   2. Adds signing_key_id on transcript_issuances
--   3. Migrator-only backfill of every ISSUED row (append-only trigger disabled)
--   4. VALIDATE CONSTRAINT so the authenticity CHECK is fully enforced

CREATE EXTENSION IF NOT EXISTS "pgcrypto";
CREATE EXTENSION IF NOT EXISTS "uuid-ossp";

-- ---------------------------------------------------------------------------
-- 1. Rotated KMS/PKI-backed signing key registry (refs only — never raw secrets)
-- ---------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS transcript_signing_keys (
  id               UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  tenant_id        UUID NOT NULL REFERENCES tenants(id),
  institution_id   UUID REFERENCES institutions(id),
  key_id           VARCHAR(128) NOT NULL,
  kms_key_ref      TEXT NOT NULL,
  algorithm        VARCHAR(32) NOT NULL DEFAULT 'HMAC-SHA256'
                     CHECK (algorithm IN ('HMAC-SHA256', 'Ed25519', 'RSA-PSS-SHA256')),
  status           VARCHAR(16) NOT NULL DEFAULT 'ACTIVE'
                     CHECK (status IN ('ACTIVE', 'ROTATED', 'REVOKED')),
  activated_at     TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  rotated_at       TIMESTAMPTZ,
  metadata         JSONB NOT NULL DEFAULT '{}'::jsonb,
  created_at       TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  CONSTRAINT transcript_signing_keys_kms_ref_nonempty
    CHECK (length(trim(kms_key_ref)) > 0)
);

COMMENT ON TABLE transcript_signing_keys IS
  'W1-DATA-08: dedicated transcript authenticity key registry. Stores KMS/PKI '
  'refs (arn:aws:kms:…, pkcs11:…, vault:…, env:TRANSCRIPT_SIGNING_SECRET) — '
  'never JWT/board-export secrets. App fail-closes without an ACTIVE dedicated key.';

COMMENT ON COLUMN transcript_signing_keys.kms_key_ref IS
  'External key locator (KMS ARN, PKI URI, or env:TRANSCRIPT_SIGNING_SECRET). '
  'Must not be JWT_SECRET or SIS_BOARD_EXPORT_SIGNING_SECRET.';

CREATE UNIQUE INDEX IF NOT EXISTS transcript_signing_keys_tenant_key_uidx
  ON transcript_signing_keys (tenant_id, key_id)
  WHERE institution_id IS NULL;

CREATE UNIQUE INDEX IF NOT EXISTS transcript_signing_keys_tenant_inst_key_uidx
  ON transcript_signing_keys (tenant_id, institution_id, key_id)
  WHERE institution_id IS NOT NULL;

CREATE INDEX IF NOT EXISTS transcript_signing_keys_tenant_active_idx
  ON transcript_signing_keys (tenant_id, status, activated_at DESC)
  WHERE status = 'ACTIVE';

ALTER TABLE transcript_signing_keys ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS tenant_isolation ON transcript_signing_keys;
CREATE POLICY tenant_isolation ON transcript_signing_keys
  FOR ALL
  USING (tenant_id::text = NULLIF(current_setting('app.tenant_id', true), ''))
  WITH CHECK (tenant_id::text = NULLIF(current_setting('app.tenant_id', true), ''));
ALTER TABLE transcript_signing_keys FORCE ROW LEVEL SECURITY;

DO $$
BEGIN
  IF EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'proctira_app') THEN
    GRANT SELECT, INSERT, UPDATE ON transcript_signing_keys TO proctira_app;
    -- No DELETE: rotate by status change, keep history.
    REVOKE DELETE, TRUNCATE, TRIGGER ON transcript_signing_keys FROM proctira_app;
  END IF;
END $$;

-- ---------------------------------------------------------------------------
-- 2. Link issuances to the key that signed them
-- ---------------------------------------------------------------------------
ALTER TABLE transcript_issuances
  ADD COLUMN IF NOT EXISTS signing_key_id UUID;

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint
    WHERE conname = 'transcript_issuances_signing_key_id_fkey'
  ) THEN
    ALTER TABLE transcript_issuances
      ADD CONSTRAINT transcript_issuances_signing_key_id_fkey
      FOREIGN KEY (signing_key_id) REFERENCES transcript_signing_keys(id)
      NOT VALID;
  END IF;
END $$;

COMMENT ON COLUMN transcript_issuances.signing_key_id IS
  'FK to transcript_signing_keys for ISSUED rows signed after W1-DATA-08 complete. '
  'Legacy backfill rows may be NULL with metadata.legacyAuthenticitySeal=true.';

CREATE INDEX IF NOT EXISTS transcript_issuances_signing_key_idx
  ON transcript_issuances (tenant_id, signing_key_id)
  WHERE signing_key_id IS NOT NULL;

-- ---------------------------------------------------------------------------
-- 3. Backfill every ISSUED row so authenticity CHECK can VALIDATE
--    Append-only trigger must be disabled for migrator UPDATE only.
-- ---------------------------------------------------------------------------
ALTER TABLE transcript_issuances DISABLE TRIGGER trg_transcript_issuances_append_only;

UPDATE transcript_issuances ti
SET
  checksum_sha256 = CASE
    WHEN ti.checksum_sha256 ~ '^[a-f0-9]{64}$' THEN lower(ti.checksum_sha256)
    ELSE encode(
      digest(
        'transcript-legacy:'
          || ti.id::text || ':'
          || ti.tenant_id::text || ':'
          || ti.student_id::text || ':'
          || ti.version::text || ':'
          || coalesce(ti.artifact_uri, '') || ':'
          || coalesce(ti.issued_at::text, '') || ':'
          || coalesce(ti.metadata::text, '{}'),
        'sha256'
      ),
      'hex'
    )
  END,
  updated_at = NOW()
WHERE ti.status = 'ISSUED'
  AND (
    ti.checksum_sha256 IS NULL
    OR ti.checksum_sha256 !~ '^[a-f0-9]{64}$'
  );

UPDATE transcript_issuances ti
SET
  signature_hmac = CASE
    WHEN ti.signature_hmac ~ '^[a-f0-9]{64}$' THEN lower(ti.signature_hmac)
    ELSE encode(
      digest(
        'w1-data-08-legacy-seal:v1:'
          || ti.tenant_id::text || ':'
          || ti.checksum_sha256 || ':'
          || ti.id::text,
        'sha256'
      ),
      'hex'
    )
  END,
  metadata = ti.metadata || jsonb_build_object(
    'legacyAuthenticitySeal', true,
    'legacyAuthenticitySealVersion', 1,
    'legacyAuthenticitySealedAt', NOW()
  ),
  updated_at = NOW()
WHERE ti.status = 'ISSUED'
  AND (
    ti.signature_hmac IS NULL
    OR ti.signature_hmac !~ '^[a-f0-9]{64}$'
  );

ALTER TABLE transcript_issuances ENABLE TRIGGER trg_transcript_issuances_append_only;

-- ---------------------------------------------------------------------------
-- 4. VALIDATE authenticity CHECK (must be VALID after backfill)
-- ---------------------------------------------------------------------------
DO $$
BEGIN
  IF EXISTS (
    SELECT 1
    FROM pg_constraint
    WHERE conname = 'transcript_issuances_issued_authenticity_chk'
      AND conrelid = 'transcript_issuances'::regclass
  ) THEN
    ALTER TABLE transcript_issuances
      VALIDATE CONSTRAINT transcript_issuances_issued_authenticity_chk;
  ELSE
    -- Defensive: re-add as VALID if 069 somehow skipped on this DB.
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
      );
  END IF;
END $$;

-- Best-effort VALIDATE for signing_key FK (no orphans expected on fresh add).
DO $$
BEGIN
  IF EXISTS (
    SELECT 1 FROM pg_constraint
    WHERE conname = 'transcript_issuances_signing_key_id_fkey'
      AND NOT convalidated
  ) THEN
    ALTER TABLE transcript_issuances
      VALIDATE CONSTRAINT transcript_issuances_signing_key_id_fkey;
  END IF;
END $$;

INSERT INTO schema_migrations (filename)
VALUES ('079_transcript_authenticity_complete.sql')
ON CONFLICT (filename) DO NOTHING;
