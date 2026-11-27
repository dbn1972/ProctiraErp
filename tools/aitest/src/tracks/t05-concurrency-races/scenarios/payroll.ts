/**
 * Payroll posting: GET /staff/payroll/export?month= persists the month's run
 * (hr-routes.ts PRC-H088). Contract (hr-service.ts PRC-M368, db/sql/246):
 * one posted run per tenant and month; a racing post returns the winner's run
 * (200, idempotent, same runId) or 409, never a second run or journal.
 * `replace=true` reverses the current run and posts one replacement; parallel
 * replaces must serialise (each reversal reverses a distinct run, exactly one
 * current run remains) with losers refused 409.
 */
import { allOf, checkStatuses, expectEq } from '../race.js';

import { okBodies, S, statusesOf, type RaceEnv, type Variant } from './env.js';
let monthSeq = 0;
/** A month no run exists for yet (far future so it never meets real data). */
async function freshMonth(env: RaceEnv): Promise<string> {
  const base = 2100 + Math.floor(Math.random() * 700);
  for (;;) {
    const k = monthSeq++;
    const month = `${base + Math.floor(k / 12)}-${String((k % 12) + 1).padStart(2, '0')}`;
    const [row] = await env.q<{ n: string }>(
      `SELECT count(*)::text AS n FROM staff_payroll_runs WHERE tenant_id = $1 AND month = $2`,
      [S, month],
    );
    if (row?.n === '0') return month;
  }
}
async function runsFor(env: RaceEnv, month: string) {
  const runs = await env.q<{
    id: string;
    status: string;
    reverses_run_id: string | null;
    replaces_run_id: string | null;
  }>(
    `SELECT id::text, status, reverses_run_id::text, replaces_run_id::text
       FROM staff_payroll_runs WHERE tenant_id = $1 AND month = $2`,
    [S, month],
  );
  const [ledger] = await env.q<{ runs: string }>(
    `SELECT count(DISTINCT l.run_id)::text AS runs
       FROM staff_payroll_ledger_entries l JOIN staff_payroll_runs r ON r.id = l.run_id
      WHERE r.tenant_id = $1 AND r.month = $2 AND r.status = 'posted'`,
    [S, month],
  );
  const reversed = new Set(
    runs.filter((r) => r.status === 'reversal').map((r) => r.reverses_run_id),
  );
  const current = runs.filter((r) => r.status === 'posted' && !reversed.has(r.id));
  return { runs, current, reversed, ledgerRuns: Number(ledger?.runs ?? 0) };
}
const exportPath = '/api/v1/staff/payroll/export';
export const payrollVariants: Variant[] = [
  {
    id: 'payroll-post:same-month-x5',
    module: 'staff/payroll',
    title: 'HR officer and principal post the same month 5x at once over both gateways',
    async run(env) {
      const month = await freshMonth(env);
      const users = [env.user('hr_officer'), env.user('principal')];
      const runs = await env.fire(5, (api, i) =>
        api.as(users[i % 2]!).get(exportPath, { query: { month } }),
      );
      const statuses = statusesOf(runs);
      const runIds = new Set(okBodies<{ runId?: string }>(runs).map((b) => b?.runId ?? '?'));
      const db = await runsFor(env, month);
      return {
        statuses,
        entities: { month },
        invariant: allOf({
          'runs for month': expectEq(db.runs.length, 1),
          'posted runs': expectEq(db.current.length, 1),
          'one runId in 2xx': { ok: runIds.size === 1, detail: [...runIds].join(',') },
          'journal for at most one run': { ok: db.ledgerRuns <= 1, detail: `${db.ledgerRuns}` },
        }),
        status: checkStatuses(statuses, { winners: { 200: [1, 5] }, losers: [409] }),
      };
    },
  },
  {
    id: 'payroll-post:replace-x3',
    module: 'staff/payroll',
    title: 'after one post, 3 parallel ?replace=true corrections of the same month',
    async run(env) {
      const month = await freshMonth(env);
      const hr = env.user('hr_officer');
      const first = await env.gateways[0]!.as(hr).get(exportPath, { query: { month } });
      if (first.status !== 200) throw new Error(`initial post -> ${first.status}`);
      const runs = await env.fire(3, (api) =>
        api.as(hr).get(exportPath, { query: { month, replace: 'true' } }),
      );
      const statuses = statusesOf(runs);
      const db = await runsFor(env, month);
      const reversals = db.runs.filter((r) => r.status === 'reversal');
      const succeeded = statuses.filter((s) => s === 200).length;
      return {
        statuses,
        entities: { month },
        invariant: allOf({
          'one current run': expectEq(db.current.length, 1),
          'a replacement happened': {
            ok: reversals.length >= 1,
            detail: `${reversals.length} reversals`,
          },
          'one reversal per successful replace': expectEq(reversals.length, succeeded),
          'each reversal reverses a distinct run': expectEq(db.reversed.size, reversals.length),
        }),
        status: checkStatuses(statuses, { winners: { 200: [1, 3] }, losers: [409] }),
      };
    },
  },
];
