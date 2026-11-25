-- PRC-M214 — DPDP erasure path for consent records (DR44).
--
-- parent_consents and student_consents are append-only (090): DELETE is
-- rejected and the body triggers reject any change to who decided. So a
-- consent record could never be erased or anonymised, and the subject
-- erasure and tenant offboard paths left the guardian's identity on every
-- consent row.
--
-- Owner rule DR44 (DECISION_REGISTER §44, 2026-10-27): keep proof of consent
-- (who, what, when, version, channel) for as long as the record it authorises
-- is retained, then anonymise it; the consent text version is never deleted.
-- Erasure of the student (or offboard of the tenant) ends that retention, so:
--
--   * privacy_anonymise_subject_consents(job uuid): SECURITY DEFINER. Allowed
--     only for an anonymization job of the bound tenant that is in_progress
--     on an erasure request that is in_progress, for a student subject, with
--     no legal hold (privacy_assert_no_legal_hold, 313). Replaces who on that
--     student's consent rows with the pseudonym 'anon:<token>' (the same
--     sha256(tenant:subject_type:subject) token the domain anonymizers use):
--     parent_consents.parent_user_id / created_by, student_consents.actor_id;
--     clears parent_consents.withdrawal_reason (free text). Kept: consent
--     type, title/description (the consent text), consent_version, status,
--     decided_at, decided_via (channel), versions and validity window.
--   * privacy_anonymise_tenant_consents(offboard_job uuid): the same for
--     every consent row of the bound tenant, allowed only while that tenant
--     offboard job is in_progress and the tenant is not held.
--   * The 090 body-immutable triggers allow exactly that change and nothing
--     else: only inside these functions (transaction-local
--     app.privacy_consent_anonymise flag AND current_user = table owner, which
--     only the SECURITY DEFINER functions are), only the who / reason columns,
--     and only to 'anon:' values (created_by may also be NULL).
--   * EXECUTE: revoked from PUBLIC, granted to proctira_app.
--
-- 090 is checksum-locked; CREATE OR REPLACE replaces its trigger functions,
-- keeping every original check for normal updates. DELETE stays rejected.
-- Additive and idempotent.
--
-- Rollback (future forward migration): re-run the 090 function bodies
-- (parent_consents_body_immutable, student_consents_body_immutable), then
--   DROP FUNCTION privacy_anonymise_subject_consents(uuid);
--   DROP FUNCTION privacy_anonymise_tenant_consents(uuid);
--   DROP FUNCTION privacy_consent_anonymise_allowed(oid);
-- Anonymised identities are not restorable.

CREATE OR REPLACE FUNCTION privacy_consent_anonymise_allowed(p_relid oid)
RETURNS boolean
LANGUAGE sql
STABLE
SET search_path = public, pg_temp
AS $$
  SELECT COALESCE(current_setting('app.privacy_consent_anonymise', true), '') <> ''
     AND current_user = (SELECT pg_get_userbyid(c.relowner) FROM pg_class c WHERE c.oid = p_relid);
$$;

COMMENT ON FUNCTION privacy_consent_anonymise_allowed(oid) IS
  'PRC-M214: true only inside privacy_anonymise_*_consents (flag set and running as the table owner).';

CREATE OR REPLACE FUNCTION parent_consents_body_immutable()
RETURNS TRIGGER AS $$
BEGIN
  -- PRC-M214 / DR44: the definer anonymisation path may replace who (and
  -- clear the free-text withdrawal reason); every other column stays as is.
  IF privacy_consent_anonymise_allowed(TG_RELID) THEN
    IF (to_jsonb(NEW) - ARRAY['parent_user_id', 'created_by', 'withdrawal_reason', 'updated_at'])
         IS DISTINCT FROM
       (to_jsonb(OLD) - ARRAY['parent_user_id', 'created_by', 'withdrawal_reason', 'updated_at'])
       OR NEW.parent_user_id NOT LIKE 'anon:%'
       OR (NEW.created_by IS NOT NULL AND NEW.created_by NOT LIKE 'anon:%')
       OR NEW.withdrawal_reason IS NOT NULL THEN
      RAISE EXCEPTION
        'parent_consents anonymisation may only pseudonymise who and clear the withdrawal reason (PRC-M214)'
        USING ERRCODE = 'integrity_constraint_violation';
    END IF;
    NEW.updated_at := now();
    RETURN NEW;
  END IF;
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

CREATE OR REPLACE FUNCTION student_consents_body_immutable()
RETURNS TRIGGER AS $$
BEGIN
  -- PRC-M214 / DR44: the definer anonymisation path may replace actor_id only.
  IF privacy_consent_anonymise_allowed(TG_RELID) THEN
    IF (to_jsonb(NEW) - 'actor_id') IS DISTINCT FROM (to_jsonb(OLD) - 'actor_id')
       OR NEW.actor_id NOT LIKE 'anon:%' THEN
      RAISE EXCEPTION
        'student_consents anonymisation may only pseudonymise actor_id (PRC-M214)'
        USING ERRCODE = 'integrity_constraint_violation';
    END IF;
    RETURN NEW;
  END IF;
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

-- Shared body: pseudonymise who on the consent rows selected by tenant and,
-- when p_student is not NULL, one student. p_token is the 16-hex pseudonym
-- token. Returns the number of rows changed. Internal (no EXECUTE grant).
CREATE OR REPLACE FUNCTION privacy_consent_anonymise_rows(
  p_tenant uuid,
  p_student text,
  p_token text
)
RETURNS integer
LANGUAGE plpgsql
SET search_path = public, pg_temp
AS $$
DECLARE
  v_pseudo text := 'anon:' || p_token;
  v_parent integer := 0;
  v_student integer := 0;
BEGIN
  PERFORM set_config('app.privacy_consent_anonymise', 'on', true);
  IF to_regclass('public.parent_consents') IS NOT NULL THEN
    UPDATE parent_consents
       SET parent_user_id = v_pseudo,
           created_by = CASE WHEN created_by IS NULL THEN NULL ELSE v_pseudo END,
           withdrawal_reason = NULL
     WHERE tenant_id = p_tenant
       AND (p_student IS NULL OR student_id::text = p_student)
       AND (parent_user_id NOT LIKE 'anon:%'
            OR (created_by IS NOT NULL AND created_by NOT LIKE 'anon:%')
            OR withdrawal_reason IS NOT NULL);
    GET DIAGNOSTICS v_parent = ROW_COUNT;
  END IF;
  IF to_regclass('public.student_consents') IS NOT NULL THEN
    UPDATE student_consents
       SET actor_id = v_pseudo
     WHERE tenant_id = p_tenant
       AND (p_student IS NULL OR student_id::text = p_student)
       AND actor_id NOT LIKE 'anon:%';
    GET DIAGNOSTICS v_student = ROW_COUNT;
  END IF;
  PERFORM set_config('app.privacy_consent_anonymise', '', true);
  RETURN v_parent + v_student;
END;
$$;

REVOKE ALL ON FUNCTION privacy_consent_anonymise_rows(uuid, text, text) FROM PUBLIC;

CREATE OR REPLACE FUNCTION privacy_anonymise_subject_consents(p_job_id uuid)
RETURNS integer
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
DECLARE
  v_bound text := NULLIF(btrim(app_tenant_id()), '');
  v_tenant uuid;
  v_subject_type text;
  v_subject_id text;
BEGIN
  IF v_bound IS NULL THEN
    RAISE EXCEPTION 'privacy_anonymise_subject_consents: no tenant bound (app.tenant_id unset)'
      USING ERRCODE = '42501';
  END IF;
  SELECT j.tenant_id, j.subject_type, j.subject_id
    INTO v_tenant, v_subject_type, v_subject_id
    FROM privacy_anonymization_jobs j
    JOIN privacy_erasure_requests r
      ON r.id = j.erasure_request_id AND r.tenant_id = j.tenant_id
   WHERE j.id = p_job_id
     AND j.tenant_id::text = lower(v_bound)
     AND j.status = 'in_progress'
     AND r.status = 'in_progress';
  IF v_tenant IS NULL THEN
    RAISE EXCEPTION 'consent anonymisation requires an in-progress erasure job of the bound tenant (job %)', p_job_id
      USING ERRCODE = '55000';
  END IF;
  IF privacy_subject_kind(v_subject_type) IS DISTINCT FROM 'student' THEN
    RETURN 0;
  END IF;
  PERFORM privacy_assert_no_legal_hold(v_tenant, 'student', v_subject_id);
  RETURN privacy_consent_anonymise_rows(
    v_tenant,
    v_subject_id,
    substr(encode(sha256(convert_to(v_tenant::text || ':' || v_subject_type || ':' || v_subject_id, 'UTF8')), 'hex'), 1, 16)
  );
END;
$$;

COMMENT ON FUNCTION privacy_anonymise_subject_consents(uuid) IS
  'PRC-M214/DR44: pseudonymise who on a student''s consent rows; only for an in-progress erasure job of the bound tenant, no legal hold (SECURITY DEFINER).';

CREATE OR REPLACE FUNCTION privacy_anonymise_tenant_consents(p_offboard_job_id uuid)
RETURNS integer
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
DECLARE
  v_bound text := NULLIF(btrim(app_tenant_id()), '');
  v_tenant uuid;
BEGIN
  IF v_bound IS NULL THEN
    RAISE EXCEPTION 'privacy_anonymise_tenant_consents: no tenant bound (app.tenant_id unset)'
      USING ERRCODE = '42501';
  END IF;
  SELECT o.tenant_id INTO v_tenant
    FROM privacy_tenant_offboard_jobs o
   WHERE o.id = p_offboard_job_id
     AND o.tenant_id::text = lower(v_bound)
     AND o.status = 'in_progress';
  IF v_tenant IS NULL THEN
    RAISE EXCEPTION 'consent anonymisation requires an in-progress offboard job of the bound tenant (job %)', p_offboard_job_id
      USING ERRCODE = '55000';
  END IF;
  PERFORM privacy_assert_no_legal_hold(v_tenant, NULL, NULL);
  RETURN privacy_consent_anonymise_rows(
    v_tenant,
    NULL,
    substr(encode(sha256(convert_to(v_tenant::text || ':tenant-offboard', 'UTF8')), 'hex'), 1, 16)
  );
END;
$$;

COMMENT ON FUNCTION privacy_anonymise_tenant_consents(uuid) IS
  'PRC-M214/DR44: pseudonymise who on every consent row of the bound tenant; only while its offboard job is in_progress, no legal hold (SECURITY DEFINER).';

REVOKE ALL ON FUNCTION privacy_anonymise_subject_consents(uuid) FROM PUBLIC;
REVOKE ALL ON FUNCTION privacy_anonymise_tenant_consents(uuid) FROM PUBLIC;
DO $$
BEGIN
  IF EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'proctira_app') THEN
    GRANT EXECUTE ON FUNCTION privacy_anonymise_subject_consents(uuid) TO proctira_app;
    GRANT EXECUTE ON FUNCTION privacy_anonymise_tenant_consents(uuid) TO proctira_app;
  END IF;
END $$;
