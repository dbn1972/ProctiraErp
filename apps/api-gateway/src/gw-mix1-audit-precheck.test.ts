/**
 * PRC-M014 — fail closed *before* the handler when the audit store is down, and
 * never rewrite an already-committed mutation into an ambiguous 503.
 */
import type { FastifyInstance } from 'fastify';
import { afterAll, beforeAll, describe, expect, it, vi } from 'vitest';

import { authHeaders, createTestConfig } from './__tests__/gateway-test-kit.js';
import { buildApp } from './app.js';
import { AuditAvailabilityGate, MutationAuditRetryQueue } from './mutation-audit.js';

delete process.env['DATABASE_URL'];

describe('audit availability pre-check (PRC-M014)', () => {
  let app: FastifyInstance;
  const savedEnv = process.env['NODE_ENV'];
  beforeAll(async () => {
    app = await buildApp({ config: createTestConfig() });
    await app.ready();
  });
  afterAll(async () => {
    process.env['NODE_ENV'] = savedEnv;
    vi.restoreAllMocks();
    await app.close();
  });

  it('audit store down → sensitive POST is refused with 503 before the handler runs', async () => {
    vi.spyOn(app.auditService, 'queryAuditLogs').mockRejectedValue(new Error('audit db down'));
    vi.spyOn(app.auditService, 'recordAudit').mockRejectedValue(new Error('audit db down'));
    process.env['NODE_ENV'] = 'production';
    try {
      const res = await app.inject({
        method: 'POST',
        url: '/api/v1/students',
        headers: authHeaders(app, { roles: ['admin'] }),
        // Deliberately incomplete: had the handler run, domain validation would 400.
        payload: { firstName: 'Ada' },
      });
      expect(res.statusCode).toBe(503);
      expect(res.json().code).toBe('AUDIT_UNAVAILABLE');
    } finally {
      process.env['NODE_ENV'] = savedEnv;
    }
  });
});

describe('AuditAvailabilityGate', () => {
  it('caches probe results, coalesces probes and trips on markUnavailable', async () => {
    let now = 0;
    const probe = vi.fn(async () => undefined);
    const gate = new AuditAvailabilityGate(probe, 5000, 1000, () => now);
    const results = await Promise.all([gate.isAvailable(), gate.isAvailable(), gate.isAvailable()]);
    expect(results).toEqual([true, true, true]);
    expect(probe).toHaveBeenCalledTimes(1);
    gate.markUnavailable();
    expect(await gate.isAvailable()).toBe(false);
    now = 6000;
    expect(await gate.isAvailable()).toBe(true);
    expect(probe).toHaveBeenCalledTimes(2);
  });

  it('a hanging probe counts as unavailable', async () => {
    const gate = new AuditAvailabilityGate(() => new Promise(() => undefined), 5000, 10);
    expect(await gate.isAvailable()).toBe(false);
  });
});

describe('MutationAuditRetryQueue', () => {
  it('retries a failed post-commit audit row until it lands exactly once', async () => {
    vi.useFakeTimers();
    try {
      let calls = 0;
      const written: unknown[] = [];
      const recorder = {
        recordAudit: async (input: unknown) => {
          calls += 1;
          if (calls === 1) throw new Error('still down');
          written.push(input);
        },
      };
      const giveUp = vi.fn();
      const queue = new MutationAuditRetryQueue(() => recorder, giveUp, [10, 20, 30]);
      queue.enqueue({
        tenantId: 't',
        entityType: 'student',
        entityId: 's1',
        operation: 'CREATE',
        userId: 'u',
        userName: 'u',
        ipAddress: '127.0.0.1',
        beforeValues: null,
        afterValues: null,
        metadata: {},
      });
      await vi.advanceTimersByTimeAsync(100);
      expect(written).toHaveLength(1);
      expect(queue.size).toBe(0);
      expect(giveUp).not.toHaveBeenCalled();
    } finally {
      vi.useRealTimers();
    }
  });
});
