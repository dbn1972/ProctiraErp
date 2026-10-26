/**
 * Behavioural tests for the shipped SDK examples (PRC-L484, PRC-L485).
 *
 * vitest only collects `src/**\/*.test.ts`, so this suite lives under src/ and
 * imports the examples from `../examples/*`.
 */
import {
  BUILT_IN_EVENT_DEFINITIONS,
  BUILT_IN_EXTENSION_POINTS,
  BUILT_IN_UI_SLOTS,
} from '@proctira/backend-plugin';
import { describe, it, expect } from 'vitest';

import exportPlugin, { escapeCSV } from '../examples/export-plugin/index.js';
import notificationPlugin from '../examples/notification-plugin/index.js';
import workflowPlugin from '../examples/workflow-plugin/index.js';
import { validateManifest } from './manifest/index.js';
import { createTestHarness } from './testing/index.js';

describe('shipped examples use only catalogue ids (PRC-L483)', () => {
  const extensionPointIds = new Set(BUILT_IN_EXTENSION_POINTS.map((ep) => ep.id));
  const uiSlotIds = new Set(BUILT_IN_UI_SLOTS.map((slot) => slot.id));
  const eventTypes = new Set<string>(BUILT_IN_EVENT_DEFINITIONS.map((ev) => ev.eventType));
  const examples = [
    ['export-plugin', exportPlugin],
    ['notification-plugin', notificationPlugin],
    ['workflow-plugin', workflowPlugin],
  ] as const;

  for (const [name, plugin] of examples) {
    it(`${name}: manifest, hooks, events and UI slots reference the catalogue`, () => {
      for (const id of plugin.manifest.requiredExtensionPoints) {
        expect(extensionPointIds.has(id) || uiSlotIds.has(id), `manifest ext point ${id}`).toBe(
          true,
        );
      }
      for (const hook of plugin.hooks) {
        expect(extensionPointIds.has(hook.extensionPointId), `hook ${hook.extensionPointId}`).toBe(
          true,
        );
      }
      for (const handler of plugin.eventHandlers) {
        expect(eventTypes.has(handler.eventType), `event ${handler.eventType}`).toBe(true);
      }
      for (const slot of plugin.uiSlots) {
        expect(uiSlotIds.has(slot.slotId), `ui slot ${slot.slotId}`).toBe(true);
      }
    });

    it(`${name}: manifest passes validateManifest`, () => {
      const result = validateManifest(plugin.manifest);
      expect(result.errors).toEqual([]);
      expect(result.valid).toBe(true);
    });
  }
});

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
    const result = await harness.invokeHook<unknown, { content: string }>(
      'export.before-generate',
      {
        entityId: 'e1',
        entityType: 'report',
        format: 'custom-csv',
        data: [{ name: '=cmd|calc' }],
        metadata: { reportName: 'r', generatedBy: 'u', generatedAt: 't', filters: {} },
      },
    );
    expect(result.success).toBe(true);
    expect(result.data?.content).toContain("'=cmd|calc");
  });

  it('fails closed when the row count exceeds the configured maximum', async () => {
    const harness = createTestHarness(exportPlugin);
    const rows = Array.from({ length: 3 }, (_, i) => ({ name: `s${i}` }));
    const result = await harness.invokeHook('export.before-generate', {
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
