-- PRC-M203 — one legal-hold guard that honours tenants.legal_hold and covers
-- the PHI tables, not only students.
--
-- 067 installed trg_privacy_block_student_delete_on_legal_hold on students
-- only, and its function looked at privacy_legal_holds rows alone: setting
-- tenants.legal_hold = true (067's own COMMENT: "destructive deletes / erasure
-- against this tenant MUST fail closed") blocked nothing, and a health or
-- counselling row of a held student could be deleted directly.
--
-- Fix:
--   1. privacy_subject_kind(text): normalises subject types the way the
--      privacy package does (employee/teacher -> staff, parent -> guardian).
--   2. privacy_assert_no_legal_hold(tenant, subject_type, subject_id):
--      SECURITY DEFINER, raises 23000 (integrity_constraint_violation) when
--      tenants.legal_hold is true, a tenant-scope hold is active, or an active
--      subject hold matches the subject. It binds app.tenant_id to the row's
--      tenant only for its own two reads (so RLS shows that tenant's holds and
--      tenants row whatever the caller bound) and restores the caller's
--      values before returning. A caller bound to a different tenant gets
--      42501, so the function cannot be used to probe another tenant's holds.
--      EXECUTE is revoked from PUBLIC and granted to the runtime roles; any
--      other role that deletes a guarded row fails closed with 42501.
--   3. privacy_block_delete_on_legal_hold(): generic BEFORE DELETE (and
--      BEFORE UPDATE OF deleted_at, soft delete) trigger function. TG_ARGV[0]
--      is the subject type, TG_ARGV[1] the column holding the subject id ('' =
--      tenant-level check only).
--   4. The 067 students trigger function now calls the guard (trigger name,
--      timing and the "legal hold ... W1-SEC-06" message are unchanged).
--   5. The guard trigger is attached to every PHI table that exists
--      (counselling and health_*), keyed on student_id when the table has it.
--      PRC-M325 attaches it to the remaining subject tables in 314.
--
-- 067 is checksum-locked and is not edited; CREATE OR REPLACE replaces its
-- function body. Additive and idempotent (CREATE OR REPLACE, DROP TRIGGER IF
-- EXISTS + CREATE TRIGGER, guarded by to_regclass and column checks).
--
-- Rollback (future forward migration): restore the 067 function body, then
--   DROP TRIGGER IF EXISTS trg_privacy_legal_hold_guard ON <each PHI table>;
--   DROP FUNCTION IF EXISTS privacy_block_delete_on_legal_hold();
--   DROP FUNCTION IF EXISTS privacy_assert_no_legal_hold(uuid, text, text);
--   DROP FUNCTION IF EXISTS privacy_subject_kind(text);

CREATE OR REPLACE FUNCTION privacy_subject_kind(p_subject_type text)
RETURNS text
LANGUAGE sql
IMMUTABLE
PARALLEL SAFE
AS $$
  SELECT CASE lower(btrim(p_subject_type))
    WHEN 'employee' THEN 'staff'
    WHEN 'teacher' THEN 'staff'
    WHEN 'parent' THEN 'guardian'
    ELSE lower(btrim(p_subject_type))
  END;
$$;

COMMENT ON FUNCTION privacy_subject_kind(text) IS
  'PRC-M203: privacy subject type normalisation (employee/teacher -> staff, parent -> guardian).';

CREATE OR REPLACE FUNCTION privacy_assert_no_legal_hold(
  p_tenant uuid,
  p_subject_type text,
  p_subject_id text
)
RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
DECLARE
  v_bound text := NULLIF(btrim(app_tenant_id()), '');
  v_prev_tenant text := current_setting('app.tenant_id', true);
  v_prev_legacy text := current_setting('app.current_tenant_id', true);
  v_tenant text;
  v_kind text := privacy_subject_kind(p_subject_type);
  v_held boolean;
BEGIN
  IF p_tenant IS NULL THEN
    RAISE EXCEPTION 'destructive delete blocked: row has no tenant (legal hold W1-SEC-06, PRC-M203)'
      USING ERRCODE = 'integrity_constraint_violation';
  END IF;
  v_tenant := lower(p_tenant::text);
  IF v_bound IS NOT NULL AND lower(v_bound) IS DISTINCT FROM v_tenant THEN
    RAISE EXCEPTION 'privacy_assert_no_legal_hold: tenant % does not match bound tenant', p_tenant
      USING ERRCODE = '42501';
  END IF;

  PERFORM set_config('app.tenant_id', v_tenant, true);
  PERFORM set_config('app.current_tenant_id', v_tenant, true);
  SELECT COALESCE((SELECT t.legal_hold FROM tenants t WHERE t.id = p_tenant), false)
      OR EXISTS (
           SELECT 1
             FROM privacy_legal_holds h
            WHERE h.tenant_id = p_tenant
              AND h.active = true
              AND (
                h.scope = 'tenant'
                OR (
                  h.scope = 'subject'
                  AND p_subject_id IS NOT NULL
                  AND h.subject_id = p_subject_id
                  AND (v_kind IS NULL OR privacy_subject_kind(h.subject_type) = v_kind)
                )
              )
         )
    INTO v_held;
  PERFORM set_config('app.tenant_id', COALESCE(v_prev_tenant, ''), true);
  PERFORM set_config('app.current_tenant_id', COALESCE(v_prev_legacy, ''), true);

  IF v_held THEN
    RAISE EXCEPTION 'destructive delete blocked: active privacy legal hold (W1-SEC-06, PRC-M203)'
      USING ERRCODE = 'integrity_constraint_violation',
            DETAIL = format('tenant %s, subject %s %s', p_tenant,
                            COALESCE(v_kind, '-'), COALESCE(p_subject_id, '-'));
  END IF;
END;
$$;

COMMENT ON FUNCTION privacy_assert_no_legal_hold(uuid, text, text) IS
  'PRC-M203: raises 23000 when tenants.legal_hold, an active tenant hold or a matching subject hold exists (SECURITY DEFINER; 42501 when bound to another tenant).';

REVOKE ALL ON FUNCTION privacy_assert_no_legal_hold(uuid, text, text) FROM PUBLIC;
DO $$
DECLARE
  r text;
BEGIN
  FOREACH r IN ARRAY ARRAY['proctira_app', 'proctira_phi_retention'] LOOP
    IF EXISTS (SELECT 1 FROM pg_roles WHERE rolname = r) THEN
      EXECUTE format(
        'GRANT EXECUTE ON FUNCTION privacy_assert_no_legal_hold(uuid, text, text) TO %I', r);
    END IF;
  END LOOP;
END $$;

CREATE OR REPLACE FUNCTION privacy_block_delete_on_legal_hold()
RETURNS trigger
LANGUAGE plpgsql
SET search_path = public, pg_temp
AS $$
DECLARE
  v_row jsonb;
  v_subject text;
BEGIN
  IF TG_OP = 'DELETE' THEN
    v_row := to_jsonb(OLD);
  ELSIF TG_OP = 'UPDATE'
        AND (to_jsonb(NEW) ->> 'deleted_at') IS NOT NULL
        AND (to_jsonb(OLD) ->> 'deleted_at') IS NULL THEN
    v_row := to_jsonb(NEW);
  ELSE
    RETURN NEW;
  END IF;
  IF TG_NARGS >= 2 AND TG_ARGV[1] <> '' THEN
    v_subject := v_row ->> TG_ARGV[1];
  END IF;
  PERFORM privacy_assert_no_legal_hold(
    (v_row ->> 'tenant_id')::uuid,
    CASE WHEN v_subject IS NULL THEN NULL ELSE TG_ARGV[0] END,
    v_subject
  );
  IF TG_OP = 'DELETE' THEN
    RETURN OLD;
  END IF;
  RETURN NEW;
END;
$$;

COMMENT ON FUNCTION privacy_block_delete_on_legal_hold() IS
  'PRC-M203: BEFORE DELETE / soft-delete legal-hold guard. TG_ARGV[0] subject type, TG_ARGV[1] subject id column ('''' = tenant only).';

-- 067's students trigger keeps its name and timing; the body now goes
-- through the shared guard (tenants.legal_hold included).
CREATE OR REPLACE FUNCTION privacy_block_student_delete_on_legal_hold()
RETURNS TRIGGER AS $$
BEGIN
  IF TG_OP = 'DELETE' THEN
    PERFORM privacy_assert_no_legal_hold(OLD.tenant_id, 'student', OLD.id::text);
    RETURN OLD;
  END IF;
  IF TG_OP = 'UPDATE' AND NEW.deleted_at IS NOT NULL AND OLD.deleted_at IS NULL THEN
    PERFORM privacy_assert_no_legal_hold(NEW.tenant_id, 'student', NEW.id::text);
  END IF;
  RETURN NEW;
END;
$$ LANGUAGE plpgsql SET search_path = public, pg_temp;

-- Attach the guard to the PHI tables (subject = student).
DO $$
DECLARE
  t text;
  v_col text;
  v_soft boolean;
BEGIN
  FOREACH t IN ARRAY ARRAY[
    'counselling_sessions',
    'health_accommodation_plans',
    'health_allergies',
    'health_conditions',
    'health_diagnoses',
    'health_insurance',
    'health_measurements',
    'health_nurse_incidents',
    'health_phi_access_log',
    'health_phi_break_glass',
    'health_referrals',
    'health_screening_programs',
    'health_special_needs_assessments',
    'health_vaccinations'
  ] LOOP
    IF to_regclass('public.' || t) IS NULL OR NOT EXISTS (
      SELECT 1 FROM information_schema.columns
       WHERE table_schema = 'public' AND table_name = t AND column_name = 'tenant_id'
    ) THEN
      RAISE NOTICE 'PRC-M203: % missing or has no tenant_id; legal-hold guard not attached', t;
      CONTINUE;
    END IF;
    SELECT CASE WHEN EXISTS (
             SELECT 1 FROM information_schema.columns
              WHERE table_schema = 'public' AND table_name = t AND column_name = 'student_id')
           THEN 'student_id' ELSE '' END,
           EXISTS (
             SELECT 1 FROM information_schema.columns
              WHERE table_schema = 'public' AND table_name = t AND column_name = 'deleted_at')
      INTO v_col, v_soft;
    EXECUTE format('DROP TRIGGER IF EXISTS trg_privacy_legal_hold_guard ON %I', t);
    EXECUTE format(
      'CREATE TRIGGER trg_privacy_legal_hold_guard BEFORE DELETE%s ON %I
         FOR EACH ROW EXECUTE FUNCTION privacy_block_delete_on_legal_hold(%L, %L)',
      CASE WHEN v_soft THEN ' OR UPDATE OF deleted_at' ELSE '' END, t, 'student', v_col);
  END LOOP;
END $$;
