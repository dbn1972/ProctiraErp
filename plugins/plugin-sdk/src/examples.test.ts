/**
 * Behavioural tests for the shipped SDK examples (PRC-L484, PRC-L485).
 *
 * vitest only collects `src/**\/*.test.ts`, so this suite lives under src/ and
 * imports the examples from `../examples/*`.
 */
import { describe, it, expect } from 'vitest';

import exportPlugin, { escapeCSV } from '../examples/export-plugin/index.js';
import workflowPlugin from '../examples/workflow-plugin/index.js';
import { createTestHarness } from './testing/index.js';

describe('export-plugin example — CSV formula-injection neutralisation (PRC-L484)', () => {
  it('prefixes formula-leading cells with an apostrophe', () => {
    expect(escapeCSV('=1+1', ',')).toBe("'=1+1");
    expect(escapeCSV('+1', ',')).toBe("'+1");
    expect(escapeCSV('-2', ',')).toBe("'-2");
    expect(escapeCSV('@SUM(A1:A2)', ',')).toBe("'@SUM(A1:A2)");
    expect(escapeCSV('=HYPERLINK("http://evil")', ',')).toBe('"\'=HYPERLINK(""http://evil"")"');
  });

  it('leaves ordinary values untouched', () => {
    expect(escapeCSV('John Doe', ',')).toBe('John Doe');
    expect(escapeCSV('123', ',')).toBe('123');
  });

  it('quotes values containing a bare carriage return', () => {
    expect(escapeCSV('a\rb', ',')).toBe('"a\rb"');
  });

  it('neutralises a formula student name when exporting via the hook', async () => {
    const harness = createTestHarness(exportPlugin);
    const result = await harness.invokeHook<unknown, { content: string }>('report.export', {
      entityId: 'e1',
      entityType: 'report',
      format: 'custom-csv',
      data: [{ name: '=cmd|calc' }],
      metadata: { reportName: 'r', generatedBy: 'u', generatedAt: 't', filters: {} },
    });
    expect(result.success).toBe(true);
    expect(result.data?.content).toContain("'=cmd|calc");
  });

  it('fails closed when the row count exceeds the configured maximum', async () => {
    const harness = createTestHarness(exportPlugin);
    const rows = Array.from({ length: 3 }, (_, i) => ({ name: `s${i}` }));
    const result = await harness.invokeHook('report.export', {
      entityId: 'e1',
      entityType: 'report',
      format: 'custom-csv',
      data: rows,
      metadata: {
        reportName: 'r',
        generatedBy: 'u',
        generatedAt: 't',
        filters: {},
        exportConfig: { maxRows: 2 },
      },
    });
    expect(result.success).toBe(false);
    expect(result.errors?.[0]?.code).toBe('EXPORT_ROW_LIMIT_EXCEEDED');
  });
});

describe('workflow-plugin example — fail-closed enrollment rule (PRC-L485)', () => {
  it('rejects a transfer with no enrollmentStartDate', async () => {
    const harness = createTestHarness(workflowPlugin);
    const result = await harness.invokeHook('workflow.before-transition', {
      entityId: 's1',
      entityType: 'student_transfer',
      fromState: 'enrolled',
      toState: 'transferred',
      action: 'transfer',
      data: { transferReason: 'relocation' },
    });
    expect(result.success).toBe(false);
    expect(result.errors?.some((e) => e.code === 'MISSING_ENROLLMENT_START_DATE')).toBe(true);
  });

  it('rejects a transfer with an invalid enrollmentStartDate', async () => {
    const harness = createTestHarness(workflowPlugin);
    const result = await harness.invokeHook('workflow.before-transition', {
      entityId: 's1',
      entityType: 'student_transfer',
      fromState: 'enrolled',
      toState: 'transferred',
      action: 'transfer',
      data: { transferReason: 'relocation', enrollmentStartDate: 'not-a-date' },
    });
    expect(result.success).toBe(false);
    expect(result.errors?.some((e) => e.code === 'INVALID_ENROLLMENT_START_DATE')).toBe(true);
  });

  it('allows a transfer that satisfies the minimum enrollment duration', async () => {
    const harness = createTestHarness(workflowPlugin);
    const longAgo = new Date(Date.now() - 90 * 24 * 60 * 60 * 1000).toISOString();
    const result = await harness.invokeHook('workflow.before-transition', {
      entityId: 's1',
      entityType: 'student_transfer',
      fromState: 'enrolled',
      toState: 'transferred',
      action: 'transfer',
      data: { transferReason: 'relocation', enrollmentStartDate: longAgo },
    });
    expect(result.success).toBe(true);
  });
});
