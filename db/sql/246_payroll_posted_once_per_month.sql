-- PRC-M207: staff_payroll_runs dropped its plain UNIQUE (tenant_id, month) in
-- db/sql/083 (so a reversal + replacement run for the same month can coexist
-- with the original posted row) without replacing it with anything scoped to
-- status='posted' -- so two concurrent "post payroll for March" requests can
-- both insert a status='posted' row for the same (tenant_id, month), a
-- double-post race.
--
-- W1-DATA-17: CREATE UNIQUE INDEX CONCURRENTLY cannot run inside a
-- transaction, so this file is applied statement-by-statement via
-- apply-sql.sh's schema_migration_phases ledger (same as db/sql/123/221).
-- Every statement below is idempotent compensating-forward DDL.
--
-- Data safety: existing duplicate (tenant_id, month) posted pairs are NOT
-- deleted (payroll is money data). The preflight fails the apply with a
-- count so an operator can reconcile first. A new database -- and this
-- worktree's shared Postgres, confirmed by live query -- has none.
-- Rollback: forward-only; a later migration may drop the index to relax.

-- 1) Preflight: refuse to build over duplicates. Lift FORCE RLS for the
--    owner scan and restore it in the same block (atomic DO block).
DO $m207_preflight$
DECLARE
  was_forced boolean;
  duplicate_groups bigint;
BEGIN
  IF to_regclass('public.staff_payroll_runs') IS NULL THEN
    RAISE NOTICE 'PRC-M207: staff_payroll_runs missing; skipping';
    RETURN;
  END IF;
  SELECT relforcerowsecurity INTO was_forced
    FROM pg_class WHERE oid = 'public.staff_payroll_runs'::regclass;
  IF was_forced THEN
    ALTER TABLE staff_payroll_runs NO FORCE ROW LEVEL SECURITY;
  END IF;
  SELECT count(*) INTO duplicate_groups
    FROM (
      SELECT 1
        FROM staff_payroll_runs
       WHERE status = 'posted'
       GROUP BY tenant_id, month
      HAVING count(*) > 1
    ) d;
  IF was_forced THEN
    ALTER TABLE staff_payroll_runs FORCE ROW LEVEL SECURITY;
  END IF;
  IF duplicate_groups > 0 THEN
    RAISE EXCEPTION
      'PRC-M207: % tenant/month group(s) already have duplicate posted payroll runs; '
      'reconcile them before re-running',
      duplicate_groups;
  END IF;
END
$m207_preflight$;

-- 2) Drop an invalid leftover from an interrupted CONCURRENTLY build before
--    rebuilding (resume path). Plain DROP of an INVALID index is safe.
DO $drop_invalid_payroll_posted_once_uidx$
BEGIN
  IF EXISTS (
    SELECT 1
      FROM pg_class c
      JOIN pg_namespace n ON n.oid = c.relnamespace
      JOIN pg_index i ON i.indexrelid = c.oid
     WHERE n.nspname = 'public'
       AND c.relname = 'staff_payroll_runs_posted_once_uidx'
       AND NOT i.indisvalid
  ) THEN
    RAISE NOTICE 'dropping invalid staff_payroll_runs_posted_once_uidx before rebuild';
    EXECUTE 'DROP INDEX IF EXISTS public.staff_payroll_runs_posted_once_uidx';
  END IF;
END
$drop_invalid_payroll_posted_once_uidx$;

-- 3) One posted run per (tenant_id, month), built CONCURRENTLY. The partial
--    WHERE clause lets reversal rows for the same month coexist (083's
--    staff_payroll_runs_reverses_once_uidx already caps each run to being
--    reversed at most once).
CREATE UNIQUE INDEX CONCURRENTLY IF NOT EXISTS staff_payroll_runs_posted_once_uidx
  ON staff_payroll_runs (tenant_id, month)
  WHERE status = 'posted';

-- 4) Present AND valid AND unique, or fail (skip when table absent).
DO $m207_assert$
BEGIN
  IF to_regclass('public.staff_payroll_runs') IS NULL THEN
    RETURN;
  END IF;
  IF NOT EXISTS (
    SELECT 1
      FROM pg_class c
      JOIN pg_namespace n ON n.oid = c.relnamespace
      JOIN pg_index i ON i.indexrelid = c.oid
     WHERE n.nspname = 'public'
       AND c.relname = 'staff_payroll_runs_posted_once_uidx'
       AND i.indisvalid
       AND i.indisunique
  ) THEN
    RAISE EXCEPTION
      'PRC-M207: staff_payroll_runs_posted_once_uidx missing or not valid/unique';
  END IF;
END
$m207_assert$;
