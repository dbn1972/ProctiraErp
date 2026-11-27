/**
 * t03 property-based invariants (money and grades) against a live Postgres.
 *
 * One describe per domain. Each domain runs AITEST_NUM_RUNS random command
 * sequences (fresh random tenant per sequence), checks every invariant after
 * every command, then shrinks each violated invariant to a minimal
 * reproduction in AITEST_OUT_DIR/counterexamples/. Case ids are
 * `prop:<domain>:<invariant>`; cases listed in pending-fixes.json are
 * reported `pending-fix` (known defect, finding id) instead of failing.
 *
 * Reproduce one case: AITEST_FOCUS=<case> AITEST_SEED=<seed> AITEST_PATH=<path>
 * [AITEST_REPLAY_PATH=<p>] pnpm --filter @proctira/aitest aitest run t03-property-invariants
 */
import { mkdirSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';

import { closeSharedPgPools, getSharedPgPool } from '@proctira/database';
import { afterAll, describe, expect, it } from 'vitest';

import { loadPendingFixes, loadStackContext, ResultsRecorder } from '../../foundation/index.js';

import { caseId, type Domain } from './core.js';
import { feesSpec } from './fees-live.js';
import { closeGradesPrisma, gradesSpec } from './grades-live.js';
import { closePayrollPrisma, payrollSpec } from './payroll-live.js';
import { closePromotionPrisma, promotionSpec } from './promotion-live.js';
import { summariseDomain, writeFindings } from './report.js';
import {
  runDomain,
  type DomainReport,
  type DomainSpec,
  type RealBase,
  type RunOptions,
} from './runner.js';
import { runSeededChecks } from './seeded.js';

const ctx = loadStackContext();
const recorder = new ResultsRecorder(ctx.outDir, 't03-property-invariants', {
  trackDir: __dirname,
});
const env = process.env;
const numRuns = Number(env['AITEST_NUM_RUNS'] ?? 100);
const seed = env['AITEST_SEED'] ? Number(env['AITEST_SEED']) : Date.now() % 2_147_483_647;
const focus = env['AITEST_FOCUS']?.trim() || undefined;
const only = (env['AITEST_DOMAINS'] ?? 'fees,payroll,grades,promotion').split(',');
const reports: DomainReport[] = [];
const pending = loadPendingFixes(__dirname);

// Report cards are written under the run's output folder, not the repo default.
env['SIS_REPORT_CARD_DIR'] ??= join(ctx.outDir, 'report-cards');

const options = (): RunOptions => ({
  numRuns,
  seed,
  outDir: ctx.outDir,
  ...(focus ? { focus } : {}),
  ...(env['AITEST_PATH'] ? { path: env['AITEST_PATH'] } : {}),
  ...(env['AITEST_REPLAY_PATH'] ? { replayPath: env['AITEST_REPLAY_PATH'] } : {}),
  shrinkMs: Number(env['AITEST_SHRINK_MS'] ?? 600_000),
});

afterAll(async () => {
  recorder.write();
  writeFindings(ctx.outDir, reports);
  mkdirSync(ctx.outDir, { recursive: true });
  writeFileSync(
    join(ctx.outDir, 'property-runs.json'),
    `${JSON.stringify(
      reports.map((r) => ({
        domain: r.domain,
        seed: r.seed,
        numRuns: r.numRuns,
        runsCompleted: r.runsCompleted,
        commandsRun: r.commandsRun,
        ms: r.ms,
        harnessError: r.harnessError,
        violations: Object.fromEntries(r.violations),
        commands: Object.fromEntries(r.stats.byCommand),
        counterexamples: r.counterexamples.map((c) => c.file),
      })),
      null,
      2,
    )}\n`,
  );
  await closePayrollPrisma();
  await closeGradesPrisma();
  await closePromotionPrisma();
  await closeSharedPgPools();
});

async function domain<M extends object, R extends RealBase, C>(
  name: Domain,
  make: () => DomainSpec<M, R, C>,
): Promise<void> {
  const spec = make();
  if (!only.includes(name) || (focus && !focus.startsWith(`prop:${name}:`))) {
    for (const id of spec.invariants.map((i) => caseId(name, i.id))) {
      recorder.record(id, 'skip', {
        reason: focus ? `focused run of ${focus}` : `AITEST_DOMAINS=${only.join(',')}`,
      });
    }
    return;
  }
  const report = await runDomain(spec, options());
  reports.push(report);
  summariseDomain(recorder, spec, report, Boolean(focus), pending);
  expect(report.harnessError, report.harnessError ?? '').toBeNull();
}

describe('t03 property invariants', () => {
  it('fees: plans, invoices, payments, refunds, concessions, netting, reconciliation', async () => {
    await domain('fees', feesSpec);
  });
  it('payroll: runs, LOP, posting, replace, offboarding', async () => {
    await domain('payroll', payrollSpec);
  });
  it('grades: schemes, marks, workflow, GPA, report cards', async () => {
    await domain('grades', gradesSpec);
  });
  it('promotion: year rollover over the grade ladder', async () => {
    await domain('promotion', promotionSpec);
  });
  it('seeded Sunrise data satisfies the same invariants (read-only)', async () => {
    if (focus) return;
    const pool = getSharedPgPool();
    if (!pool) throw new Error('DATABASE_URL is required');
    await runSeededChecks(recorder, pool);
  });
  it('no case failed', () => {
    expect(recorder.failures()).toEqual([]);
  });
});
