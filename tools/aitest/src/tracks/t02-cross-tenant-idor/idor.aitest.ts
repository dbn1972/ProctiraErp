/**
 * t02 cross-tenant / IDOR live suite.
 *
 * Weekly full (`t02-cross-tenant-idor`): path, query and body id substitution
 * across the whole API inventory in both directions, plus list filters,
 * export/report routes and tenant header/host tampering.
 * Nightly quick (`t02-cross-tenant-idor-quick`, AITEST_T02_SCOPE=get-path):
 * GET routes with path ids only, one direction.
 *
 * Expectation for every case: 401/403/404 (400 only for malformed-id kinds),
 * no victim-tenant data in the body, and no change to either tenant's data.
 * Failing assertions are findings (findings.csv) and their case ids live in
 * pending-fixes.json so the committed suite asserts only correct behaviour.
 */
import { afterAll, describe, expect, it } from 'vitest';

import { FindingsWriter, loadStackContext, ResultsRecorder } from '../../foundation/index.js';

import {
  runHeaderTamper,
  runIdorSweep,
  runListsAndExports,
  setupHarness,
  writeCoverage,
  type IdorHarness,
} from './harness.js';

const ctx = loadStackContext();
const scope = process.env['AITEST_T02_SCOPE'] === 'get-path' ? 'get-path' : 'full';
const recorder = new ResultsRecorder(ctx.outDir, 't02-cross-tenant-idor', { trackDir: __dirname });
const findings = new FindingsWriter(ctx.outDir, '02');

let h: IdorHarness;

afterAll(() => {
  if (h) writeCoverage(h);
  recorder.write();
  findings.write();
});

describe('t02 cross-tenant / IDOR', () => {
  it('sets up inventory, leak index and fixtures', async () => {
    h = await setupHarness(ctx, recorder, findings, scope);
    expect(h.routes.length).toBeGreaterThan(300);
    expect(h.nonEmptyTables['S']?.length ?? 0).toBeGreaterThan(0);
  });

  it(
    'path / query / body id substitution is refused with no leak and no state change',
    async () => {
      await runIdorSweep(h);
    },
    20 * 60_000,
  );

  it(
    'list filters and export/report routes return no cross-tenant rows',
    async () => {
      if (scope === 'get-path') {
        recorder.record('lists-exports:skipped-quick', 'skip', {
          reason: 'quick scope (get-path) runs GET path ids only',
        });
        return;
      }
      await runListsAndExports(h);
    },
    10 * 60_000,
  );

  it('tenant header / host tampering leaks no victim data', async () => {
    if (scope === 'get-path') {
      recorder.record('header-tamper:skipped-quick', 'skip', {
        reason: 'quick scope (get-path) runs GET path ids only',
      });
      return;
    }
    await runHeaderTamper(h);
  });

  it('no case failed (pending-fix findings are allowed)', () => {
    const fails = recorder.failures();
    expect(fails, `failing cases: ${fails.map((f) => f.caseId).join(', ')}`).toEqual([]);
  });
});
