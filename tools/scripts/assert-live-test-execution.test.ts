import { describe, expect, it } from 'vitest';

import {
  evaluateLiveReport,
  isLiveTestFile,
  summarizeLiveTests,
} from './assert-live-test-execution.mjs';

const skippedReport = {
  success: true,
  numPassedTests: 2,
  numPendingTests: 0,
  testResults: [
    {
      name: '/repo/packages/shared/database/src/app-runtime-role.live.test.ts',
      status: 'passed',
      assertionResults: [
        { status: 'skipped', title: 'a' },
        { status: 'skipped', title: 'b' },
      ],
    },
  ],
};

const executedReport = {
  success: true,
  testResults: [
    {
      name: '/repo/packages/shared/database/src/app-runtime-role.live.test.ts',
      status: 'passed',
      assertionResults: [
        { status: 'passed', title: 'a' },
        { status: 'passed', title: 'b' },
      ],
    },
    {
      name: '/repo/packages/backend/fees/src/pg-fees-ledger.live.test.ts',
      status: 'passed',
      assertionResults: Array.from({ length: 10 }, (_, i) => ({
        status: 'passed',
        title: `case-${i}`,
      })),
    },
  ],
};

describe('W3-TEST-03 assert-live-test-execution', () => {
  it('detects live test file names', () => {
    expect(isLiveTestFile('x.live.test.ts')).toBe(true);
    expect(isLiveTestFile('src/integration/rls-live.test.ts')).toBe(true);
    expect(isLiveTestFile('unit.test.ts')).toBe(false);
  });

  it('counts skipped assertions even when Vitest marks the file passed', () => {
    const s = summarizeLiveTests(skippedReport);
    expect(s.skipped).toBe(2);
    expect(s.executed).toBe(0);
  });

  it('FAILS when CI has skipped live cases (the silent-pass defect)', () => {
    const result = evaluateLiveReport(skippedReport, {
      CI: 'true',
      DATABASE_URL: 'postgres://x',
    });
    expect(result.ok).toBe(false);
    expect(result.errors.join(' ')).toMatch(/skipped/i);
  });

  it('FAILS when DATABASE_URL is missing under CI', () => {
    const result = evaluateLiveReport(executedReport, { CI: 'true' });
    expect(result.ok).toBe(false);
    expect(result.errors.join(' ')).toMatch(/DATABASE_URL/);
  });

  it('PASSES when enough live cases executed with no skips', () => {
    const result = evaluateLiveReport(
      executedReport,
      { CI: 'true', DATABASE_URL: 'postgres://x', LIVE_TEST_MIN_EXECUTED: '10' },
      10,
    );
    expect(result.ok).toBe(true);
    expect(result.summary.executed).toBeGreaterThanOrEqual(10);
    expect(result.summary.skipped).toBe(0);
  });
});
