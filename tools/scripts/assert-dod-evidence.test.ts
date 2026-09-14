import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { describe, expect, it } from 'vitest';

import {
  DEFAULT_BASELINE_PATH,
  DEFAULT_REPORT_PATH,
  REQUIRED_CHECK_IDS,
  evaluateBaselinePack,
  evaluateDodReport,
  evaluateEvidencePaths,
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
      checks: [{ check: 'table-naming', title: 'x', filesScanned: 1, errorCount: 0, warningCount: 0, findings: [] }],
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
