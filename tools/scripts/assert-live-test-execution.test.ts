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

describe('PRC-L378 ALLOW_LIVE_TEST_SKIP cannot silence the integration gate', () => {
  it('CI=true + ALLOW_LIVE_TEST_SKIP=1 in integration (REQUIRE_LIVE_TESTS, DATABASE_URL) -> exit 1', async () => {
    const { main } = await import('./assert-live-test-execution.mjs');
    const { mkdtempSync, rmSync, writeFileSync } = await import('node:fs');
    const { tmpdir } = await import('node:os');
    const { join } = await import('node:path');
    const dir = mkdtempSync(join(tmpdir(), 'live-assert-'));
    try {
      const path = join(dir, 'report.json');
      writeFileSync(path, JSON.stringify(skippedReport));
      const env = {
        CI: 'true',
        ALLOW_LIVE_TEST_SKIP: '1',
        REQUIRE_LIVE_TESTS: '1',
        DATABASE_URL: 'postgres://x',
      };
      expect(main([path], env)).toBe(1);
      // The DATABASE_URL alone marks the integration context under CI.
      expect(
        main([path], { CI: 'true', ALLOW_LIVE_TEST_SKIP: '1', DATABASE_URL: 'postgres://x' }),
      ).toBe(1);
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });

  it('still honours the override for unit-only CI jobs without a database', () => {
    const result = evaluateLiveReport(
      { testResults: [] },
      { CI: 'true', ALLOW_LIVE_TEST_SKIP: '1' },
    );
    expect(result.ok).toBe(true);
  });

  it('enforces the executed minimum when required even without DATABASE_URL', () => {
    const result = evaluateLiveReport({ testResults: [] }, { REQUIRE_LIVE_TESTS: '1' }, 10);
    expect(result.errors.join(' ')).toMatch(/executed 0 case\(s\); minimum is 10/);
  });
});
