import { describe, expect, it } from 'vitest';

import {
  evaluateVitestReport,
  isPgGateFile,
  summarizeReport,
} from './assert-vitest-skips.mjs';

const skippedPgReport = {
  testResults: [
    {
      name: '/repo/packages/backend/fees/src/pg-fees-repository.test.ts',
      status: 'passed',
      assertionResults: [
        { status: 'skipped', title: 'a' },
        { status: 'skipped', title: 'b' },
      ],
    },
  ],
};

const executedPgReport = {
  testResults: [
    {
      name: '/repo/packages/backend/fees/src/pg-fees-repository.test.ts',
      status: 'passed',
      assertionResults: Array.from({ length: 30 }, (_, i) => ({
        status: 'passed',
        title: `case-${i}`,
      })),
    },
    {
      name: '/repo/packages/backend/audit/src/pg-audit-repository.test.ts',
      status: 'passed',
      assertionResults: Array.from({ length: 10 }, (_, i) => ({
        status: 'passed',
        title: `audit-${i}`,
      })),
    },
  ],
};

describe('W3-TEST-04 assert-vitest-skips', () => {
  it('detects pg gate file names and excludes live tests', () => {
    expect(isPgGateFile('packages/backend/fees/src/pg-fees-repository.test.ts')).toBe(true);
    expect(isPgGateFile('packages/backend/fees/src/pg-fees-ledger.live.test.ts')).toBe(false);
    expect(isPgGateFile('packages/backend/student/src/prisma-student-repository.integration.test.ts')).toBe(
      true,
    );
  });

  it('counts skipped pg assertions even when Vitest marks the file passed', () => {
    const s = summarizeReport(skippedPgReport, { profile: 'pg' });
    expect(s.skipped).toBe(2);
    expect(s.executed).toBe(0);
  });

  it('FAILS when CI has skipped pg cases beyond the inverse-skip allowance', () => {
    const result = evaluateVitestReport(
      skippedPgReport,
      { CI: 'true', DATABASE_URL: 'postgres://x', FORBID_TEST_SKIPS: '1' },
      { profile: 'pg', maxAllowedSkips: 0 },
    );
    expect(result.ok).toBe(false);
    expect(result.errors.join(' ')).toMatch(/skipped/i);
  });

  it('PASSES when enough pg cases executed with only the allowed inverse skip', () => {
    const withInverseSkip = {
      testResults: [
        ...executedPgReport.testResults,
        {
          name: '/repo/packages/backend/institution/src/infrastructure/pg-store.test.ts',
          status: 'passed',
          assertionResults: [{ status: 'skipped', title: 'is skipped without a database' }],
        },
      ],
    };
    const result = evaluateVitestReport(
      withInverseSkip,
      { CI: 'true', DATABASE_URL: 'postgres://x', FORBID_TEST_SKIPS: '1' },
      { profile: 'pg', minExecuted: 25, maxAllowedSkips: 1 },
    );
    expect(result.ok).toBe(true);
    expect(result.summary.executed).toBeGreaterThanOrEqual(25);
    expect(result.summary.skipped).toBe(1);
  });
});
