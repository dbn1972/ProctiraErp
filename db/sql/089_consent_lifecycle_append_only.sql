-- W1-PRIV-01 COMPLETE: immutable, versioned consent lifecycle.
-- Additive follow-up to 052_parent_consent_version.sql (PARTIAL: consent_version only).
--
-- Done posture:
--   * parent_consents / student_consents are append-only versioned rows
--   * withdraw / supersede INSERT a successor with effective dating; priors stay readable
--   * historical body fields cannot be mutated (UPDATE rejected except closing valid_to)
--   * DELETE rejected
--
-- Sections gate on table existence so domain ensureSchema helpers can apply
-- this file independently.

-- ---------------------------------------------------------------------------
-- parent_consents — chain versions + immutable body + close-only valid_to
-- ---------------------------------------------------------------------------
DO $$
BEGIN
  IF to_regclass('public.parent_consents') IS NULL THEN
    RETURN;
  END IF;

  ALTER TABLE parent_consents ADD COLUMN IF NOT EXISTS consent_chain_id UUID;
  ALTER TABLE parent_consents ADD COLUMN IF NOT EXISTS version INTEGER NOT NULL DEFAULT 1;
  ALTER TABLE parent_consents ADD COLUMN IF NOT EXISTS supersedes_id UUID;
  ALTER TABLE parent_consents ADD COLUMN IF NOT EXISTS valid_from TIMESTAMPTZ;
  ALTER TABLE parent_consents ADD COLUMN IF NOT EXISTS valid_to TIMESTAMPTZ;

  -- Backfill logical chain + open window for legacy rows.
  UPDATE parent_consents
     SET consent_chain_id = COALESCE(consent_chain_id, id),
         valid_from = COALESCE(valid_from, created_at, now()),
         version = COALESCE(version, 1)
   WHERE consent_chain_id IS NULL
      OR valid_from IS NULL;

  ALTER TABLE parent_consents
    ALTER COLUMN consent_chain_id SET NOT NULL,
    ALTER COLUMN valid_from SET NOT NULL;

  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint WHERE conname = 'parent_consents_supersedes_id_fkey'
  ) THEN
    ALTER TABLE parent_consents
      ADD CONSTRAINT parent_consents_supersedes_id_fkey
      FOREIGN KEY (supersedes_id) REFERENCES parent_consents(id);
  END IF;

  CREATE UNIQUE INDEX IF NOT EXISTS parent_consents_chain_version_uidx
    ON parent_consents (tenant_id, consent_chain_id, version);

  -- At most one open (current) version per chain.
  CREATE UNIQUE INDEX IF NOT EXISTS parent_consents_chain_open_uidx
    ON parent_consents (tenant_id, consent_chain_id)
    WHERE valid_to IS NULL;
END $$;

CREATE OR REPLACE FUNCTION parent_consents_body_immutable()
RETURNS TRIGGER AS $$
BEGIN
  IF NEW.id IS DISTINCT FROM OLD.id
     OR NEW.tenant_id IS DISTINCT FROM OLD.tenant_id
     OR NEW.student_id IS DISTINCT FROM OLD.student_id
     OR NEW.parent_user_id IS DISTINCT FROM OLD.parent_user_id
     OR NEW.consent_type IS DISTINCT FROM OLD.consent_type
     OR NEW.title IS DISTINCT FROM OLD.title
     OR NEW.description IS DISTINCT FROM OLD.description
     OR NEW.consent_version IS DISTINCT FROM OLD.consent_version
     OR NEW.status IS DISTINCT FROM OLD.status
     OR NEW.decided_at IS DISTINCT FROM OLD.decided_at
     OR NEW.created_by IS DISTINCT FROM OLD.created_by
     OR NEW.consent_chain_id IS DISTINCT FROM OLD.consent_chain_id
     OR NEW.version IS DISTINCT FROM OLD.version
     OR NEW.supersedes_id IS DISTINCT FROM OLD.supersedes_id
     OR NEW.valid_from IS DISTINCT FROM OLD.valid_from
     OR NEW.created_at IS DISTINCT FROM OLD.created_at THEN
    RAISE EXCEPTION
      'parent_consents body/status/version are immutable; insert a successor version (withdraw/supersede/decide)'
      USING ERRCODE = 'integrity_constraint_violation';
  END IF;

  -- valid_to may only close or narrow (never reopen / extend).
  IF NEW.valid_to IS DISTINCT FROM OLD.valid_to THEN
    IF OLD.valid_to IS NOT NULL AND NEW.valid_to IS NULL THEN
      RAISE EXCEPTION
        'parent_consents valid_to cannot be reopened once closed; insert a successor version'
        USING ERRCODE = 'integrity_constraint_violation';
    END IF;
    IF OLD.valid_to IS NOT NULL AND NEW.valid_to > OLD.valid_to THEN
      RAISE EXCEPTION
        'parent_consents valid_to can only narrow; insert a successor version to extend'
        USING ERRCODE = 'integrity_constraint_violation';
    END IF;
    IF NEW.valid_to IS NOT NULL AND NEW.valid_to < NEW.valid_from THEN
      RAISE EXCEPTION
        'parent_consents valid_to must be on or after valid_from'
        USING ERRCODE = 'check_violation';
    END IF;
  END IF;

  NEW.updated_at := now();
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

CREATE OR REPLACE FUNCTION parent_consents_reject_delete()
RETURNS TRIGGER AS $$
BEGIN
  RAISE EXCEPTION 'parent_consents is append-only (DELETE rejected)'
    USING ERRCODE = 'integrity_constraint_violation';
END;
$$ LANGUAGE plpgsql;

DO $$
BEGIN
  IF to_regclass('public.parent_consents') IS NULL THEN
    RETURN;
  END IF;

  DROP TRIGGER IF EXISTS trg_parent_consents_body_immutable ON parent_consents;
  CREATE TRIGGER trg_parent_consents_body_immutable
    BEFORE UPDATE ON parent_consents
    FOR EACH ROW
    EXECUTE FUNCTION parent_consents_body_immutable();

  DROP TRIGGER IF EXISTS trg_parent_consents_reject_delete ON parent_consents;
  CREATE TRIGGER trg_parent_consents_reject_delete
    BEFORE DELETE ON parent_consents
    FOR EACH ROW
    EXECUTE FUNCTION parent_consents_reject_delete();
END $$;

COMMENT ON COLUMN parent_consents.consent_chain_id IS
  'Stable logical consent id across append-only versions.';
COMMENT ON COLUMN parent_consents.version IS
  'Monotonic version within consent_chain_id; corrections INSERT a successor.';
COMMENT ON COLUMN parent_consents.supersedes_id IS
  'Prior consent row this version supersedes (decide/withdraw/supersede).';
COMMENT ON COLUMN parent_consents.valid_from IS
  'Inclusive start of this consent version effective window.';
COMMENT ON COLUMN parent_consents.valid_to IS
  'Exclusive/end of window when superseded; NULL = current open version.';

-- ---------------------------------------------------------------------------
-- student_consents — drop silent UPSERT uniqueness; versioned effective rows
-- ---------------------------------------------------------------------------
DO $$
BEGIN
  IF to_regclass('public.student_consents') IS NULL THEN
    RETURN;
  END IF;

  ALTER TABLE student_consents ADD COLUMN IF NOT EXISTS version INTEGER NOT NULL DEFAULT 1;
  ALTER TABLE student_consents ADD COLUMN IF NOT EXISTS supersedes_id UUID;
  ALTER TABLE student_consents ADD COLUMN IF NOT EXISTS valid_from TIMESTAMPTZ;
  ALTER TABLE student_consents ADD COLUMN IF NOT EXISTS valid_to TIMESTAMPTZ;

  UPDATE student_consents
     SET valid_from = COALESCE(valid_from, recorded_at, now()),
         version = COALESCE(version, 1)
   WHERE valid_from IS NULL;

  ALTER TABLE student_consents
    ALTER COLUMN valid_from SET NOT NULL;

  -- Remove silent-overwrite uniqueness (tenant, student, kind).
  ALTER TABLE student_consents
    DROP CONSTRAINT IF EXISTS student_consents_tenant_id_student_id_kind_key;
  DROP INDEX IF EXISTS student_consents_tenant_id_student_id_kind_key;

  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint WHERE conname = 'student_consents_supersedes_id_fkey'
  ) THEN
    ALTER TABLE student_consents
      ADD CONSTRAINT student_consents_supersedes_id_fkey
      FOREIGN KEY (supersedes_id) REFERENCES student_consents(id);
  END IF;

  CREATE UNIQUE INDEX IF NOT EXISTS student_consents_kind_version_uidx
    ON student_consents (tenant_id, student_id, kind, version);

  CREATE UNIQUE INDEX IF NOT EXISTS student_consents_kind_open_uidx
    ON student_consents (tenant_id, student_id, kind)
    WHERE valid_to IS NULL;
END $$;

CREATE OR REPLACE FUNCTION student_consents_body_immutable()
RETURNS TRIGGER AS $$
BEGIN
  IF NEW.id IS DISTINCT FROM OLD.id
     OR NEW.tenant_id IS DISTINCT FROM OLD.tenant_id
     OR NEW.student_id IS DISTINCT FROM OLD.student_id
     OR NEW.kind IS DISTINCT FROM OLD.kind
     OR NEW.granted IS DISTINCT FROM OLD.granted
     OR NEW.actor_id IS DISTINCT FROM OLD.actor_id
     OR NEW.recorded_at IS DISTINCT FROM OLD.recorded_at
     OR NEW.version IS DISTINCT FROM OLD.version
     OR NEW.supersedes_id IS DISTINCT FROM OLD.supersedes_id
     OR NEW.valid_from IS DISTINCT FROM OLD.valid_from THEN
    RAISE EXCEPTION
      'student_consents body/version are immutable; insert a successor version'
      USING ERRCODE = 'integrity_constraint_violation';
  END IF;

  IF NEW.valid_to IS DISTINCT FROM OLD.valid_to THEN
    IF OLD.valid_to IS NOT NULL AND NEW.valid_to IS NULL THEN
      RAISE EXCEPTION
        'student_consents valid_to cannot be reopened once closed; insert a successor version'
        USING ERRCODE = 'integrity_constraint_violation';
    END IF;
    IF OLD.valid_to IS NOT NULL AND NEW.valid_to > OLD.valid_to THEN
      RAISE EXCEPTION
        'student_consents valid_to can only narrow; insert a successor version to extend'
        USING ERRCODE = 'integrity_constraint_violation';
    END IF;
    IF NEW.valid_to IS NOT NULL AND NEW.valid_to < NEW.valid_from THEN
      RAISE EXCEPTION
        'student_consents valid_to must be on or after valid_from'
        USING ERRCODE = 'check_violation';
    END IF;
  END IF;

  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

CREATE OR REPLACE FUNCTION student_consents_reject_delete()
RETURNS TRIGGER AS $$
BEGIN
  RAISE EXCEPTION 'student_consents is append-only (DELETE rejected)'
    USING ERRCODE = 'integrity_constraint_violation';
END;
$$ LANGUAGE plpgsql;

DO $$
BEGIN
  IF to_regclass('public.student_consents') IS NULL THEN
    RETURN;
  END IF;

  DROP TRIGGER IF EXISTS trg_student_consents_body_immutable ON student_consents;
  CREATE TRIGGER trg_student_consents_body_immutable
    BEFORE UPDATE ON student_consents
    FOR EACH ROW
    EXECUTE FUNCTION student_consents_body_immutable();

  DROP TRIGGER IF EXISTS trg_student_consents_reject_delete ON student_consents;
  CREATE TRIGGER trg_student_consents_reject_delete
    BEFORE DELETE ON student_consents
    FOR EACH ROW
    EXECUTE FUNCTION student_consents_reject_delete();
END $$;

COMMENT ON COLUMN student_consents.version IS
  'Monotonic version for (tenant, student, kind); corrections INSERT a successor.';
COMMENT ON COLUMN student_consents.supersedes_id IS
  'Prior student consent row this version supersedes.';
COMMENT ON COLUMN student_consents.valid_from IS
  'Inclusive start of this consent version effective window.';
COMMENT ON COLUMN student_consents.valid_to IS
  'End of window when superseded; NULL = current open version.';

DO $$
BEGIN
  IF to_regclass('public.schema_migrations') IS NOT NULL THEN
    INSERT INTO schema_migrations (filename)
    VALUES ('089_consent_lifecycle_append_only.sql')
    ON CONFLICT DO NOTHING;
  END IF;
END $$;
