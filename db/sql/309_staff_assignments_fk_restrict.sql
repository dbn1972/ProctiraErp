-- PRC-L297: staff_assignments cascades on a staff delete, although
-- authorization derives from it (packages/backend/auth/src/
-- institution-assignments.ts reads staff_assignments to scope a teacher), and
-- staff_user_id_idx (098) indexes staff(user_id) without tenant_id.
--
-- A hard DELETE FROM staff silently removed every assignment, so the
-- assignment history behind past authorization decisions vanished with no
-- audit trail. The application never hard-deletes a staff member: the staff
-- repository soft-deletes (staff.deleted_at), and purgeCreated only removes a
-- row created moments earlier in the same failed create. So the cascade only
-- ever fired for direct SQL.
--
-- Fix:
--   1. Both staff FKs on staff_assignments become ON DELETE RESTRICT:
--      staff_assignments_staff_fk (staff_id -> staff.id, 098) and
--      staff_assignments_staff_id_tenant_fk ((tenant_id, staff_id) ->
--      staff (tenant_id, id)). A staff row with assignments can no longer be
--      hard-deleted; end the assignments (status/end_date) and soft-delete.
--      Each FK is re-added NOT VALID and then VALIDATEd with FORCE ROW LEVEL
--      SECURITY lifted on the two tables for the duration (the db/sql/257 and
--      307 pattern), and FORCE is restored and asserted before commit.
--   2. Drop staff_user_id_idx. The tenant-leading unique index
--      uq_staff_user_id_per_tenant (tenant_id, user_id) WHERE user_id IS NOT
--      NULL already serves every lookup, and every caller filters by tenant.
--
-- 098 is checksum-locked, so this is a forward migration. Idempotent: the FKs
-- are only rebuilt while their delete action is not RESTRICT.
DO $prc_l297$
DECLARE
  spec record;
  rebuilt int := 0;
  lifted text[] := ARRAY[]::text[];
  rel text;
  remaining text;
BEGIN
  IF to_regclass('public.staff_assignments') IS NULL OR to_regclass('public.staff') IS NULL THEN
    RAISE NOTICE 'PRC-L297: staff/staff_assignments absent, skipping';
    RETURN;
  END IF;
  IF current_setting('lock_timeout') IN ('0', '0ms')
     OR current_setting('statement_timeout') IN ('0', '0ms') THEN
    RAISE EXCEPTION 'PRC-L297: lock_timeout and statement_timeout must be non-zero; apply through tools/scripts/apply-sql.sh';
  END IF;

  FOREACH rel IN ARRAY ARRAY['staff_assignments', 'staff'] LOOP
    IF EXISTS (SELECT 1 FROM pg_class WHERE oid = ('public.' || rel)::regclass
                AND relforcerowsecurity) THEN
      EXECUTE format('ALTER TABLE public.%I NO FORCE ROW LEVEL SECURITY', rel);
      lifted := lifted || rel;
    END IF;
  END LOOP;

  FOR spec IN
    SELECT * FROM (VALUES
      ('staff_assignments_staff_fk', 'FOREIGN KEY (staff_id) REFERENCES staff (id)'),
      ('staff_assignments_staff_id_tenant_fk',
       'FOREIGN KEY (tenant_id, staff_id) REFERENCES staff (tenant_id, id)')
    ) AS s(conname, def)
  LOOP
    IF EXISTS (
      SELECT 1 FROM pg_constraint
       WHERE conrelid = 'public.staff_assignments'::regclass
         AND conname = spec.conname
         AND confdeltype = 'r'
    ) THEN
      CONTINUE;
    END IF;
    EXECUTE format('ALTER TABLE public.staff_assignments DROP CONSTRAINT IF EXISTS %I', spec.conname);
    EXECUTE format(
      'ALTER TABLE public.staff_assignments ADD CONSTRAINT %I %s ON DELETE RESTRICT NOT VALID',
      spec.conname, spec.def);
    EXECUTE format('ALTER TABLE public.staff_assignments VALIDATE CONSTRAINT %I', spec.conname);
    rebuilt := rebuilt + 1;
  END LOOP;

  FOREACH rel IN ARRAY lifted LOOP
    EXECUTE format('ALTER TABLE public.%I FORCE ROW LEVEL SECURITY', rel);
  END LOOP;

  SELECT string_agg(relname, ', ') INTO remaining
    FROM pg_class
   WHERE relnamespace = 'public'::regnamespace
     AND relname = ANY (lifted)
     AND NOT relforcerowsecurity;
  IF remaining IS NOT NULL THEN
    RAISE EXCEPTION 'PRC-L297: FORCE ROW LEVEL SECURITY not restored on: %', remaining;
  END IF;

  -- No staff FK on staff_assignments may cascade or be left unvalidated.
  SELECT string_agg(conname, ', ') INTO remaining
    FROM pg_constraint
   WHERE conrelid = 'public.staff_assignments'::regclass
     AND contype = 'f'
     AND confrelid = 'public.staff'::regclass
     AND (confdeltype <> 'r' OR NOT convalidated);
  IF remaining IS NOT NULL THEN
    RAISE EXCEPTION 'PRC-L297: staff FKs on staff_assignments not RESTRICT/validated: %', remaining;
  END IF;

  IF to_regclass('public.uq_staff_user_id_per_tenant') IS NULL THEN
    RAISE EXCEPTION 'PRC-L297: uq_staff_user_id_per_tenant (tenant_id, user_id) is missing; refusing to drop staff_user_id_idx';
  END IF;
  DROP INDEX IF EXISTS public.staff_user_id_idx;

  RAISE NOTICE 'PRC-L297: % staff FK(s) rebuilt as ON DELETE RESTRICT; staff_user_id_idx dropped', rebuilt;
END
$prc_l297$;
