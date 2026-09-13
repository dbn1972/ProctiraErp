-- W1-PRIV-01 (C2): consent records must carry the policy/form version at write time.

ALTER TABLE parent_consents
  ADD COLUMN IF NOT EXISTS consent_version TEXT;

UPDATE parent_consents
  SET consent_version = 'legacy-unversioned'
  WHERE consent_version IS NULL;

ALTER TABLE parent_consents
  ALTER COLUMN consent_version SET NOT NULL;

COMMENT ON COLUMN parent_consents.consent_version IS
  'Immutable policy/form version the parent saw when deciding.';
