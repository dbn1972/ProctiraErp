-- NEW-g2_data-002 — health_phi_break_glass sanctioned-transition guard.
--
-- health_phi_break_glass grants temporary unredaction of a minor's PHI fields
-- under dual control. The table is in the `dml` class (it legitimately needs
-- UPDATE to move pending→approved/denied and to expire/revoke), but nothing
-- enforced WHICH transitions are allowed or froze the authority fields after
-- approval. A compromised/injected app-role session could therefore:
--   * self-approve its own grant (set status=approved, approver=itself)
--   * back-date or extend expires_at / duration_minutes past the cap
--   * flip a denied/expired grant back to approved
--
-- 049 already has a requester<>approver CHECK and a duration cap CHECK. This
-- migration adds a BEFORE UPDATE trigger that:
--   * allows only sanctioned status transitions
--       pending  -> approved | denied | expired
--       approved -> expired  | revoked
--       (denied/expired/revoked are terminal)
--   * requires approver_user_id to be set and <> requester on approval
--   * freezes requester_user_id, approver_user_id, duration_minutes, approved_at
--     and expires_at once the grant is approved (no back-dating / extension)
--   * forbids changing the identity columns (requester/student/field_path) ever
--
-- The approval path should run through a SECURITY DEFINER function in the health
-- service; this DB trigger is the backstop that holds even if the app role is
-- abused. Additive / idempotent (CREATE OR REPLACE + DROP/CREATE TRIGGER).
-- 049 is checksum-locked and is not edited.

DO $bg_guard$
BEGIN
  IF to_regclass('public.health_phi_break_glass') IS NULL THEN
    RAISE NOTICE 'NEW-g2_data-002: health_phi_break_glass missing; skipping';
    RETURN;
  END IF;

  CREATE OR REPLACE FUNCTION health_phi_break_glass_guard() RETURNS trigger AS $fn$
  BEGIN
    -- Identity columns are immutable for the life of the grant.
    IF NEW.tenant_id IS DISTINCT FROM OLD.tenant_id
       OR NEW.requester_user_id IS DISTINCT FROM OLD.requester_user_id
       OR NEW.student_id IS DISTINCT FROM OLD.student_id
       OR NEW.field_path IS DISTINCT FROM OLD.field_path THEN
      RAISE EXCEPTION 'health_phi_break_glass: identity columns are immutable'
        USING ERRCODE = '42501';
    END IF;

    -- Sanctioned status transitions only.
    IF NEW.status IS DISTINCT FROM OLD.status THEN
      IF NOT (
        (OLD.status = 'pending'  AND NEW.status IN ('approved', 'denied', 'expired'))
        OR (OLD.status = 'approved' AND NEW.status IN ('expired', 'revoked'))
      ) THEN
        RAISE EXCEPTION 'health_phi_break_glass: illegal status transition % -> %',
          OLD.status, NEW.status USING ERRCODE = '42501';
      END IF;
    END IF;

    -- Approval requires a distinct approver (dual control).
    IF NEW.status = 'approved' AND OLD.status = 'pending' THEN
      IF NEW.approver_user_id IS NULL OR NEW.approver_user_id = NEW.requester_user_id THEN
        RAISE EXCEPTION 'health_phi_break_glass: approval needs a distinct approver (dual control)'
          USING ERRCODE = '42501';
      END IF;
    END IF;

    -- Once approved, the authority fields are frozen (no back-dating/extension).
    IF OLD.status = 'approved' THEN
      IF NEW.approver_user_id IS DISTINCT FROM OLD.approver_user_id
         OR NEW.duration_minutes IS DISTINCT FROM OLD.duration_minutes
         OR NEW.approved_at IS DISTINCT FROM OLD.approved_at
         OR NEW.expires_at IS DISTINCT FROM OLD.expires_at THEN
        RAISE EXCEPTION 'health_phi_break_glass: authority fields are frozen after approval'
          USING ERRCODE = '42501';
      END IF;
    END IF;

    RETURN NEW;
  END;
  $fn$ LANGUAGE plpgsql;

  DROP TRIGGER IF EXISTS trg_health_phi_break_glass_guard ON health_phi_break_glass;
  CREATE TRIGGER trg_health_phi_break_glass_guard
    BEFORE UPDATE ON health_phi_break_glass
    FOR EACH ROW EXECUTE FUNCTION health_phi_break_glass_guard();
END
$bg_guard$;

DO $bg_assert$
BEGIN
  IF to_regclass('public.health_phi_break_glass') IS NULL THEN
    RETURN;
  END IF;
  IF NOT EXISTS (
    SELECT 1 FROM pg_trigger
     WHERE tgrelid = 'public.health_phi_break_glass'::regclass
       AND tgname = 'trg_health_phi_break_glass_guard'
       AND NOT tgisinternal
  ) THEN
    RAISE EXCEPTION 'NEW-g2_data-002: break-glass guard trigger missing';
  END IF;
END
$bg_assert$;

COMMENT ON TRIGGER trg_health_phi_break_glass_guard ON health_phi_break_glass IS
  'NEW-g2_data-002 dual-control guard: sanctioned status transitions + frozen authority fields after approval.';

INSERT INTO schema_migrations (filename)
VALUES ('192_health_phi_break_glass_transition_guard.sql')
ON CONFLICT (filename) DO NOTHING;
