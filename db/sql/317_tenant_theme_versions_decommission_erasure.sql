-- PRC-L147 — decommission-only erasure path for the append-only
-- tenant_theme_versions table, and a runtime grant that never targets the
-- migrator.
--
-- Prisma migration 20250524_add_tenant_theme_versions (applied, locked):
--   * BEFORE DELETE trigger tenant_theme_versions_no_delete rejects every
--     DELETE, and tenant_theme_versions_tenant_id_fkey is ON DELETE RESTRICT,
--     so a tenant's branding history can never be erased and blocks deleting
--     the tenant row: tenant offboarding cannot finish.
--   * Its grant block resolved the runtime role from app.application_role and
--     fell back to current_user when the GUC was unset (CI and every install
--     we know of), so it revoked/granted on the migrator. The runtime role's
--     real privileges come from db/runtime-table-privileges.json, which
--     classed the table `dml` (UPDATE + DELETE for proctira_app).
--
-- Owner rule DR48 (DECISION_REGISTER §48, 2026-10-27): on tenant decommission,
-- append-only tables get a decommission-only erasure path under dual control,
-- and the erasure is recorded in the platform audit trail.
--
-- Fix:
--   1. privacy_tenant_offboard_jobs.approved_by TEXT + CHECK (approved_by IS
--      NULL OR approved_by <> requested_by): the second actor of an offboard.
--   2. privacy_decommission_erase_theme_versions(offboard_job uuid),
--      SECURITY DEFINER: only for the bound tenant's offboard job that is
--      in_progress AND approved by a second actor (approved_by set and not the
--      requester), with no legal hold (313). Deletes that tenant's
--      tenant_theme_versions rows and enqueues one audit_ingest_queue event
--      (entity tenant_theme_versions, DELETE, actor = approver, metadata: job,
--      requester, approver, row count, basis DR48) in the same transaction;
--      the gateway drain seals it into the keyed audit chain. Returns the row
--      count. EXECUTE: proctira_app only.
--   3. tenant_theme_versions_block_delete(): still rejects every DELETE except
--      inside that function (transaction-local app.privacy_decommission_erasure
--      equal to the row's tenant AND current_user = table owner). UPDATE stays
--      rejected.
--   4. Grants: the table owner gets SELECT, INSERT, DELETE back (the 20250524
--      block may have revoked them from it); the runtime role (app.application_role
--      when set, else proctira_app; skipped with a NOTICE when it would be the
--      migrator itself or does not exist) gets SELECT, INSERT only. The table is
--      reclassified `append_only` in db/runtime-table-privileges.json so the
--      privilege sync keeps it that way.
--
-- Not done here: the offboard workflow step that records approved_by (service
-- and route), and DR48's export and 90-day delay. Until a second actor
-- approves the offboard job, the function refuses and the rows stay.
--
-- Additive and idempotent. Rollback (future forward migration):
--   DROP FUNCTION privacy_decommission_erase_theme_versions(uuid);
--   restore the 20250524 body of tenant_theme_versions_block_delete();
--   ALTER TABLE privacy_tenant_offboard_jobs DROP CONSTRAINT privacy_offboard_approver_distinct;
--   reclassify the table `dml` in db/runtime-table-privileges.json.
--   Erased branding history is not restorable.

ALTER TABLE privacy_tenant_offboard_jobs ADD COLUMN IF NOT EXISTS approved_by TEXT;

COMMENT ON COLUMN privacy_tenant_offboard_jobs.approved_by IS
  'PRC-L147/DR48: second actor who approved the decommission; never the requester.';

-- FORCE RLS is lifted for the VALIDATE and restored in the same transaction
-- (098/100 pattern), so the scan sees every tenant's rows.
DO $l147$
DECLARE
  v_forced boolean;
BEGIN
  SELECT relforcerowsecurity INTO v_forced
    FROM pg_class WHERE oid = 'public.privacy_tenant_offboard_jobs'::regclass;
  IF v_forced THEN
    ALTER TABLE privacy_tenant_offboard_jobs NO FORCE ROW LEVEL SECURITY;
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'privacy_offboard_approver_distinct') THEN
    ALTER TABLE privacy_tenant_offboard_jobs
      ADD CONSTRAINT privacy_offboard_approver_distinct
      CHECK (approved_by IS NULL OR approved_by <> requested_by) NOT VALID;
  END IF;
  ALTER TABLE privacy_tenant_offboard_jobs VALIDATE CONSTRAINT privacy_offboard_approver_distinct;
  IF v_forced THEN
    ALTER TABLE privacy_tenant_offboard_jobs FORCE ROW LEVEL SECURITY;
  END IF;
END
$l147$;

CREATE OR REPLACE FUNCTION tenant_theme_versions_block_delete()
RETURNS trigger
LANGUAGE plpgsql
SET search_path = public, pg_temp
AS $$
BEGIN
  -- PRC-L147 / DR48: only the decommission-only definer path may delete.
  IF COALESCE(current_setting('app.privacy_decommission_erasure', true), '') = OLD.tenant_id::text
     AND current_user = (SELECT pg_get_userbyid(c.relowner) FROM pg_class c WHERE c.oid = TG_RELID) THEN
    RETURN OLD;
  END IF;
  RAISE EXCEPTION 'tenant_theme_versions is append-only; DELETE is not permitted'
    USING ERRCODE = 'feature_not_supported';
END;
$$;

CREATE OR REPLACE FUNCTION privacy_decommission_erase_theme_versions(p_offboard_job_id uuid)
RETURNS integer
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
DECLARE
  v_bound text := NULLIF(btrim(app_tenant_id()), '');
  v_tenant uuid;
  v_requested_by text;
  v_approved_by text;
  v_count integer := 0;
BEGIN
  IF v_bound IS NULL THEN
    RAISE EXCEPTION 'privacy_decommission_erase_theme_versions: no tenant bound (app.tenant_id unset)'
      USING ERRCODE = '42501';
  END IF;
  SELECT o.tenant_id, o.requested_by, o.approved_by
    INTO v_tenant, v_requested_by, v_approved_by
    FROM privacy_tenant_offboard_jobs o
   WHERE o.id = p_offboard_job_id
     AND o.tenant_id::text = lower(v_bound)
     AND o.status = 'in_progress';
  IF v_tenant IS NULL THEN
    RAISE EXCEPTION 'decommission erasure requires an in-progress offboard job of the bound tenant (job %)', p_offboard_job_id
      USING ERRCODE = '55000';
  END IF;
  IF v_approved_by IS NULL OR btrim(v_approved_by) = '' OR v_approved_by = v_requested_by THEN
    RAISE EXCEPTION 'decommission erasure requires a second-actor approval on offboard job % (dual control, DR48)', p_offboard_job_id
      USING ERRCODE = '55000';
  END IF;
  PERFORM privacy_assert_no_legal_hold(v_tenant, NULL, NULL);

  PERFORM set_config('app.privacy_decommission_erasure', v_tenant::text, true);
  DELETE FROM tenant_theme_versions WHERE tenant_id = v_tenant;
  GET DIAGNOSTICS v_count = ROW_COUNT;
  PERFORM set_config('app.privacy_decommission_erasure', '', true);

  INSERT INTO audit_ingest_queue (
    tenant_id, entity_type, entity_id, operation, user_id, actor_kind, user_name,
    before_values, after_values, metadata, dedupe_key
  ) VALUES (
    v_tenant, 'tenant_theme_versions', v_tenant::text, 'DELETE', v_approved_by,
    'system:tenant-decommission', v_approved_by,
    jsonb_build_object('rows', v_count), NULL,
    jsonb_build_object(
      'offboardJobId', p_offboard_job_id,
      'requestedBy', v_requested_by,
      'approvedBy', v_approved_by,
      'rowsDeleted', v_count,
      'basis', 'DR48 decommission-only erasure (PRC-L147)'
    ),
    'tenant-decommission:' || p_offboard_job_id::text || ':tenant_theme_versions'
  )
  ON CONFLICT DO NOTHING;
  RETURN v_count;
END;
$$;

COMMENT ON FUNCTION privacy_decommission_erase_theme_versions(uuid) IS
  'PRC-L147/DR48: erase the bound tenant''s tenant_theme_versions for an in-progress, second-actor-approved offboard job; audited via audit_ingest_queue (SECURITY DEFINER).';

REVOKE ALL ON FUNCTION privacy_decommission_erase_theme_versions(uuid) FROM PUBLIC;

DO $grants$
DECLARE
  v_owner text;
  v_app text := COALESCE(NULLIF(current_setting('app.application_role', true), ''), 'proctira_app');
BEGIN
  SELECT pg_get_userbyid(relowner) INTO v_owner
    FROM pg_class WHERE oid = 'public.tenant_theme_versions'::regclass;
  EXECUTE format('GRANT SELECT, INSERT, DELETE ON TABLE tenant_theme_versions TO %I', v_owner);
  IF v_app = v_owner OR v_app = current_user THEN
    RAISE NOTICE 'PRC-L147: runtime role % is the migrator/owner; runtime grant skipped', v_app;
  ELSIF NOT EXISTS (SELECT 1 FROM pg_roles WHERE rolname = v_app) THEN
    RAISE NOTICE 'PRC-L147: runtime role % missing; runtime grant skipped', v_app;
  ELSE
    EXECUTE format('REVOKE UPDATE, DELETE, TRUNCATE ON TABLE tenant_theme_versions FROM %I', v_app);
    EXECUTE format('GRANT SELECT, INSERT ON TABLE tenant_theme_versions TO %I', v_app);
    EXECUTE format(
      'GRANT EXECUTE ON FUNCTION privacy_decommission_erase_theme_versions(uuid) TO %I', v_app);
  END IF;
END
$grants$;
