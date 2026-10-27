/**
 * Tests for the SDK testing helpers (PRC-L486: previously untested SDK area):
 * assertHookResult, assertPluginManifest, mockHookContext, mockEventPayload.
 */
import type { HookResult } from '@proctira/backend-plugin';
import { describe, it, expect } from 'vitest';
import exportPlugin from '../../examples/export-plugin/index.js';
import { assertHookResult, assertPluginManifest } from './assertions.js';
import { mockEventPayload } from './mock-event-payload.js';
import { mockHookContext } from './mock-hook-context.js';

const ok: HookResult = { success: true, executionTimeMs: 5 };

describe('assertHookResult', () => {
  it('passes for a successful result with default expectations', () => {
    expect(() => assertHookResult(ok)).not.toThrow();
  });

  it('throws when a success was expected but the hook failed', () => {
    expect(() => assertHookResult({ success: false, executionTimeMs: 1 })).toThrow(
      /Expected hook to succeed/,
    );
  });

  it('throws when a failure was expected but the hook succeeded', () => {
    expect(() => assertHookResult(ok, { success: false })).toThrow(
      /Expected hook to fail but it succeeded/,
    );
  });

  it('passes for an expected failure', () => {
    expect(() =>
      assertHookResult({ success: false, executionTimeMs: 1 }, { success: false }),
    ).not.toThrow();
  });

  it('throws on validation errors unless noErrors is disabled', () => {
    const withErrors: HookResult = {
      success: true,
      executionTimeMs: 1,
      errors: [{ field: 'name', message: 'required', code: 'REQUIRED' }],
    };
    expect(() => assertHookResult(withErrors)).toThrow(/Expected no validation errors but got 1/);
    expect(() => assertHookResult(withErrors, { noErrors: false })).not.toThrow();
  });

  it('throws on abort unless noAbort is disabled', () => {
    const aborted: HookResult = {
      success: true,
      executionTimeMs: 1,
      abort: true,
      abortReason: 'blocked',
    };
    expect(() => assertHookResult(aborted)).toThrow(/Expected hook not to abort.*blocked/);
    expect(() => assertHookResult(aborted, { noAbort: false })).not.toThrow();
  });

  it('enforces maxExecutionTimeMs', () => {
    expect(() => assertHookResult(ok, { maxExecutionTimeMs: 4 })).toThrow(
      /execution time 5ms exceeded maximum 4ms/,
    );
    expect(() => assertHookResult(ok, { maxExecutionTimeMs: 5 })).not.toThrow();
  });
});

describe('assertPluginManifest', () => {
  it('passes for a valid manifest', () => {
    expect(() => assertPluginManifest(exportPlugin.manifest)).not.toThrow();
  });

  it('throws with the failing paths for an invalid manifest', () => {
    expect(() => assertPluginManifest({ name: 'x' })).toThrow(/Plugin manifest is invalid/);
  });
});

describe('mockHookContext', () => {
  it('fills defaults', () => {
    const ctx = mockHookContext();
    expect(ctx.tenantId).toBe('test-tenant-001');
    expect(ctx.actorId).toBe('test-user-001');
    expect(ctx.extensionPointId).toBe('test.extension-point');
    expect(ctx.pluginInstallId).toBe('test-install-001');
    expect(ctx.correlationId).toMatch(/^test-corr-\d+$/);
    expect(ctx.timestamp).toBeInstanceOf(Date);
  });

  it('applies overrides', () => {
    const timestamp = new Date('2026-01-01T00:00:00Z');
    const ctx = mockHookContext({
      tenantId: 't-1',
      actorId: 'u-1',
      extensionPointId: 'ep',
      pluginInstallId: 'pi',
      correlationId: 'c-1',
      timestamp,
    });
    expect(ctx).toEqual({
      tenantId: 't-1',
      actorId: 'u-1',
      extensionPointId: 'ep',
      pluginInstallId: 'pi',
      correlationId: 'c-1',
      timestamp,
    });
  });
});

describe('mockEventPayload', () => {
  it('derives entityType from the event type and fills defaults', () => {
    const ev = mockEventPayload('student.created');
    expect(ev.eventType).toBe('student.created');
    expect(ev.entityType).toBe('student');
    expect(ev.tenantId).toBe('test-tenant-001');
    expect(ev.actorId).toBe('test-user-001');
    expect(ev.entityId).toMatch(/^test-entity-\d+$/);
    expect(ev.data).toEqual({});
    expect(ev.timestamp).toBeInstanceOf(Date);
  });

  it('applies overrides', () => {
    const ev = mockEventPayload('student.created', {
      tenantId: 't-1',
      entityId: 'stu-1',
      entityType: 'learner',
      data: { grade: '10' },
      correlationId: 'c-1',
    });
    expect(ev.tenantId).toBe('t-1');
    expect(ev.entityId).toBe('stu-1');
    expect(ev.entityType).toBe('learner');
    expect(ev.data).toEqual({ grade: '10' });
    expect(ev.correlationId).toBe('c-1');
  });
});
