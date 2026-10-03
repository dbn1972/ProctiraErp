-- PRC-L318: allow 'running' in the academic rollover ledger status CHECK.
--
-- The claim-first rollover ledger (packages/backend/institution calendar-service,
-- wired in apps/api-gateway domain-plugins behind ROLLOVER_LEDGER_CLAIM_FIRST)
-- inserts the ledger row as 'running' before executing, then moves it to
-- 'completed' or 'failed'. 047 declared an inline CHECK over
-- ('dry_run', 'completed', 'failed'), so that INSERT raised 23514.
--
-- 047's inline CHECK is named academic_rollover_runs_status_check by Postgres.
-- It is replaced by a superset, so every existing row already satisfies it.
--
-- Data safety: no row is rewritten. The new constraint is added NOT VALID (new
-- writes checked immediately) and then validated (SHARE UPDATE EXCLUSIVE scan;
-- the superset cannot fail on existing rows). The runner applies this file in a
-- single transaction, so there is no window without a status CHECK. Idempotent.
--
-- Rollback: forward-only. To revert, first move 'running' rows to 'failed', then
-- re-add the 047 set in a new migration.
ALTER TABLE academic_rollover_runs DROP CONSTRAINT IF EXISTS academic_rollover_runs_status_check;

ALTER TABLE academic_rollover_runs
  ADD CONSTRAINT academic_rollover_runs_status_check
  CHECK (status IN ('dry_run', 'running', 'completed', 'failed')) NOT VALID;

-- FORCE RLS would make the owner's validation scan see zero rows; lift it for
-- the scan and restore it in the same transaction (db/sql/100 pattern).
ALTER TABLE academic_rollover_runs NO FORCE ROW LEVEL SECURITY;
ALTER TABLE academic_rollover_runs VALIDATE CONSTRAINT academic_rollover_runs_status_check;
ALTER TABLE academic_rollover_runs FORCE ROW LEVEL SECURITY;
