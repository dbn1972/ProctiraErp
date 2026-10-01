import { mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import { describe, expect, it } from 'vitest';

import {
  DEFAULT_BASELINE_PATH,
  DEFAULT_REPORT_PATH,
  REQUIRED_CHECK_IDS,
  evaluateBaselinePack,
  evaluateDodReport,
  evaluateEvidencePaths,
  evaluateReportAgainstBaseline,
  main,
} from './assert-dod-evidence.mjs';

const repoRoot = resolve(import.meta.dirname, '..', '..');

function loadJson(path: string) {
  return JSON.parse(readFileSync(path, 'utf8'));
}

describe('W3-D6 assert-dod-evidence', () => {
  it('accepts the committed baseline pack with all seven checks', () => {
    const baseline = loadJson(DEFAULT_BASELINE_PATH);
    const result = evaluateBaselinePack(baseline);
    expect(result.ok).toBe(true);
    expect(result.errors).toEqual([]);
  });

  it('accepts a real dod-report.json when present on disk', () => {
    const report = loadJson(DEFAULT_REPORT_PATH);
    const result = evaluateDodReport(report);
    expect(result.ok).toBe(true);
    expect(result.checkIds).toEqual(REQUIRED_CHECK_IDS);
  });

  it('FAILS when a partial --only report omits required checks', () => {
    const partial = {
      schemaVersion: 1,
      generatedAt: new Date().toISOString(),
      charterRef: 'Section 32 (Definition of Done)',
      totals: { totalErrors: 0, totalWarnings: 0, totalFiles: 1 },
      checks: [
        {
          check: 'table-naming',
          title: 'x',
          filesScanned: 1,
          errorCount: 0,
          warningCount: 0,
          findings: [],
        },
      ],
    };
    const result = evaluateDodReport(partial);
    expect(result.ok).toBe(false);
    expect(result.errors.join(' ')).toMatch(/missing required DoD checks/);
  });

  it('FAILS when the report artifact path is missing', () => {
    const result = evaluateEvidencePaths({
      reportPath: resolve(repoRoot, 'tools/dod-checks/reports/does-not-exist.json'),
      baselinePath: DEFAULT_BASELINE_PATH,
    });
    expect(result.ok).toBe(false);
    expect(result.errors.join(' ')).toMatch(/missing DoD JSON report/);
  });

  describe('PRC-L379 baseline regression and freshness', () => {
    const baseline = loadJson(DEFAULT_BASELINE_PATH);
    const fresh = () => ({
      ...structuredClone(baseline),
      generatedAt: new Date().toISOString(),
      commitSha: 'abc123',
    });

    function writeReport(report: unknown) {
      const dir = mkdtempSync(join(tmpdir(), 'dod-evidence-'));
      const path = join(dir, 'dod-report.json');
      writeFileSync(path, JSON.stringify(report));
      return { dir, path };
    }

    it('accepts a fresh report equal to the baseline', () => {
      expect(evaluateReportAgainstBaseline(fresh(), baseline)).toEqual({ ok: true, errors: [] });
    });

    it('report with an injected error finding makes the gate exit 1', () => {
      const report = fresh();
      const check = report.checks[0];
      check.findings.push({
        check: check.check,
        severity: 'error',
        file: 'packages/backend/injected/src/x.ts',
        message: 'injected regression',
      });
      check.errorCount += 1;
      report.totals.totalErrors += 1;
      const { dir, path } = writeReport(report);
      try {
        expect(main([path], { DOD_BASELINE_PATH: DEFAULT_BASELINE_PATH })).toBe(1);
        const r = evaluateReportAgainstBaseline(report, baseline);
        expect(r.errors.join(' ')).toMatch(/new error finding not in baseline/);
      } finally {
        rmSync(dir, { recursive: true, force: true });
      }
    });

    it('FAILS when totals are tampered to hide findings', () => {
      const report = fresh();
      report.totals.totalErrors = 0;
      const r = evaluateReportAgainstBaseline(report, baseline);
      expect(r.ok).toBe(false);
      expect(r.errors.join(' ')).toMatch(/totals.totalErrors 0 !=/);
    });

    it('stale report (generatedAt > 1 day) fails', () => {
      const report = fresh();
      report.generatedAt = new Date(Date.now() - 25 * 60 * 60 * 1000).toISOString();
      const { dir, path } = writeReport(report);
      try {
        expect(main([path], { DOD_BASELINE_PATH: DEFAULT_BASELINE_PATH })).toBe(1);
      } finally {
        rmSync(dir, { recursive: true, force: true });
      }
    });

    it('FAILS in GitHub Actions when commitSha does not match GITHUB_SHA', () => {
      const { dir, path } = writeReport(fresh());
      try {
        const env = { DOD_BASELINE_PATH: DEFAULT_BASELINE_PATH, GITHUB_ACTIONS: 'true' };
        expect(main([path], { ...env, GITHUB_SHA: 'abc123' })).toBe(0);
        expect(main([path], { ...env, GITHUB_SHA: 'def456' })).toBe(1);
      } finally {
        rmSync(dir, { recursive: true, force: true });
      }
    });
  });

  it('FAILS when schemaVersion is wrong (silent pass defect)', () => {
    const bad = {
      schemaVersion: 99,
      generatedAt: new Date().toISOString(),
      charterRef: 'Section 32 (Definition of Done)',
      totals: { totalErrors: 0, totalWarnings: 0, totalFiles: 0 },
      checks: REQUIRED_CHECK_IDS.map((check) => ({
        check,
        title: check,
        filesScanned: 0,
        errorCount: 0,
        warningCount: 0,
        findings: [],
      })),
    };
    const result = evaluateDodReport(bad);
    expect(result.ok).toBe(false);
    expect(result.errors.join(' ')).toMatch(/schemaVersion/);
  });
});
