/**
 * PRC-L148 — tenant_id is bound once tenant resolution (a later onRequest hook)
 * has run, and oversized / malformed client request ids are replaced.
 */
import Fastify from 'fastify';
import { describe, it, expect } from 'vitest';
import { loggingPlugin } from './fastify-plugin.js';

describe('loggingPlugin tenant binding and id validation (PRC-L148)', () => {
  it('request logger carries tenant_id after tenant resolution', async () => {
    const app = Fastify({ logger: false });
    await app.register(loggingPlugin);
    // Simulates the tenant plugin registered after logging (gateway order).
    app.decorateRequest('tenantId', undefined);
    app.addHook('onRequest', async (request) => {
      (request as unknown as { tenantId: string }).tenantId = 'tenant-abc';
    });
    let bindings: Record<string, unknown> = {};
    app.get('/t', async (request) => {
      bindings = request.requestLog.bindings();
      return { ok: true };
    });
    const res = await app.inject({ method: 'GET', url: '/t' });
    expect(res.statusCode).toBe(200);
    expect(bindings['tenant_id']).toBe('tenant-abc');
    await app.close();
  });

  it('replaces a 10KB x-request-id and a malformed correlation id', async () => {
    const app = Fastify({ logger: false });
    await app.register(loggingPlugin);
    let reqId = '';
    let corrId = '';
    app.get('/t', async (request) => {
      reqId = request.reqId;
      corrId = request.correlationId;
      return { ok: true };
    });
    const huge = 'a'.repeat(10 * 1024);
    const res = await app.inject({
      method: 'GET',
      url: '/t',
      headers: { 'x-request-id': huge, 'x-correlation-id': 'bad id <script>' },
    });
    expect(reqId).not.toBe(huge);
    expect(reqId).toMatch(/^[0-9a-f-]{36}$/);
    expect(corrId).toMatch(/^[0-9a-f-]{36}$/);
    expect(res.headers['x-request-id']).toBe(reqId);
    await app.close();
  });

  it('keeps a well-formed client request id', async () => {
    const app = Fastify({ logger: false });
    await app.register(loggingPlugin);
    let reqId = '';
    app.get('/t', async (request) => {
      reqId = request.reqId;
      return { ok: true };
    });
    await app.inject({
      method: 'GET',
      url: '/t',
      headers: { 'x-request-id': 'custom-req-id-123' },
    });
    expect(reqId).toBe('custom-req-id-123');
    await app.close();
  });
});
