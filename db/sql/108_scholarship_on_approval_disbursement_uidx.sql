-- PRC-H083: at most one on-approval disbursement per scholarship application.
--
-- ScholarshipService.approveApplication schedules the first instalment inside
-- PgScholarshipRepository.approveApplicationAtomic and tags it with the literal
-- notes value 'Scheduled on approval'. The application row lock serialises the
-- happy path, but nothing in the schema stopped a second approval path (retry,
-- second replica, manual insert) from writing another on-approval instalment for
-- the same application. This partial unique index is that backstop: a duplicate
-- raises 23505 and the approval transaction (slot claim + status flip) rolls back.
--
-- The marker is the existing notes literal so no application change is needed to
-- benefit from the index. If the literal ever changes, change it here in a new
-- forward migration in the same release.
--
-- Non-transactional file: the index is on an existing, populated table, so it is
-- built online. Every statement is idempotent (apply-sql.sh phase ledger).
--
-- Data safety: existing duplicates are NOT deleted or edited (they are money
-- records). The preflight below fails the apply with a count instead, so an
-- operator can reconcile them first. A new database has none.
--
-- Rollback: forward-only. To relax, a later migration drops
-- scholarship_disbursements_on_approval_uidx; no data depends on it.

-- 1) Preflight: refuse to build over duplicates. Under FORCE ROW LEVEL SECURITY
--    the owner scan sees zero rows without app.tenant_id, so lift FORCE for the
--    count and restore it inside the same statement (one implicit transaction).
DO $h083_preflight$
DECLARE
  was_forced boolean;
  duplicate_groups bigint;
BEGIN
  SELECT relforcerowsecurity INTO was_forced
    FROM pg_class WHERE oid = 'public.scholarship_disbursements'::regclass;
  IF was_forced THEN
    ALTER TABLE scholarship_disbursements NO FORCE ROW LEVEL SECURITY;
  END IF;
  SELECT count(*) INTO duplicate_groups
    FROM (
      SELECT 1
        FROM scholarship_disbursements
       WHERE notes = 'Scheduled on approval'
       GROUP BY tenant_id, application_id
      HAVING count(*) > 1
    ) d;
  IF was_forced THEN
    ALTER TABLE scholarship_disbursements FORCE ROW LEVEL SECURITY;
  END IF;
  IF duplicate_groups > 0 THEN
    RAISE EXCEPTION
      'PRC-H083: % application(s) already have more than one on-approval disbursement; '
      'reconcile them (cancel the extra instalments and change their notes) before re-running',
      duplicate_groups;
  END IF;
END
$h083_preflight$;

-- 2) An interrupted online build leaves an INVALID index that IF NOT EXISTS
--    would then skip forever. Drop it so the build below retries.
DO $h083_drop_invalid$
BEGIN
  IF EXISTS (
    SELECT 1
      FROM pg_class c
      JOIN pg_namespace n ON n.oid = c.relnamespace
      JOIN pg_index i ON i.indexrelid = c.oid
     WHERE n.nspname = 'public'
       AND c.relname = 'scholarship_disbursements_on_approval_uidx'
       AND NOT i.indisvalid
  ) THEN
    EXECUTE 'DROP INDEX IF EXISTS public.scholarship_disbursements_on_approval_uidx';
  END IF;
END
$h083_drop_invalid$;

CREATE UNIQUE INDEX CONCURRENTLY IF NOT EXISTS scholarship_disbursements_on_approval_uidx
  ON scholarship_disbursements (tenant_id, application_id)
  WHERE notes = 'Scheduled on approval';

-- 3) Present AND valid, or fail the apply.
DO $h083_assert$
BEGIN
  IF NOT EXISTS (
    SELECT 1
      FROM pg_class c
      JOIN pg_namespace n ON n.oid = c.relnamespace
      JOIN pg_index i ON i.indexrelid = c.oid
     WHERE n.nspname = 'public'
       AND c.relname = 'scholarship_disbursements_on_approval_uidx'
       AND i.indisvalid
       AND i.indisunique
  ) THEN
    RAISE EXCEPTION 'PRC-H083: scholarship_disbursements_on_approval_uidx missing or INVALID';
  END IF;
END
$h083_assert$;
