import type { FastifyInstance } from 'fastify';
import Fastify from 'fastify';
import { describe, it, expect, beforeEach, afterEach } from 'vitest';

import { loggingPlugin } from './fastify-plugin.js';

describe('loggingPlugin', () => {
  let app: FastifyInstance;

  beforeEach(async () => {
    app = Fastify({ logger: false });
  });

  afterEach(async () => {
    await app.close();
  });

  it('should register without errors', async () => {
    await app.register(loggingPlugin);
    await app.ready();
  });

  it('should generate request ID when not provided in header', async () => {
    await app.register(loggingPlugin);

    let capturedRequestId = '';
    app.get('/test', async (request) => {
      capturedRequestId = request.reqId;
      return { ok: true };
    });

    await app.ready();
    const response = await app.inject({ method: 'GET', url: '/test' });

    expect(response.statusCode).toBe(200);
    expect(capturedRequestId).toBeDefined();
    expect(capturedRequestId.length).toBeGreaterThan(0);
    // UUID v4 format
    expect(capturedRequestId).toMatch(
      /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i,
    );
  });

  it('should use request ID from X-Request-ID header', async () => {
    await app.register(loggingPlugin);

    let capturedRequestId = '';
    app.get('/test', async (request) => {
      capturedRequestId = request.reqId;
      return { ok: true };
    });

    await app.ready();
    const response = await app.inject({
      method: 'GET',
      url: '/test',
      headers: { 'x-request-id': 'custom-req-id-123' },
    });

    expect(response.statusCode).toBe(200);
    expect(capturedRequestId).toBe('custom-req-id-123');
  });

  it('should generate correlation ID when not provided in header', async () => {
    await app.register(loggingPlugin);

    let capturedCorrelationId = '';
    app.get('/test', async (request) => {
      capturedCorrelationId = request.correlationId;
      return { ok: true };
    });

    await app.ready();
    await app.inject({ method: 'GET', url: '/test' });

    expect(capturedCorrelationId).toBeDefined();
    expect(capturedCorrelationId.length).toBeGreaterThan(0);
    expect(capturedCorrelationId).toMatch(
      /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i,
    );
  });

  it('should use correlation ID from X-Correlation-ID header', async () => {
    await app.register(loggingPlugin);

    let capturedCorrelationId = '';
    app.get('/test', async (request) => {
      capturedCorrelationId = request.correlationId;
      return { ok: true };
    });

    await app.ready();
    await app.inject({
      method: 'GET',
      url: '/test',
      headers: { 'x-correlation-id': 'corr-456' },
    });

    expect(capturedCorrelationId).toBe('corr-456');
  });

  it('should return request ID and correlation ID in response headers', async () => {
    await app.register(loggingPlugin);

    app.get('/test', async () => ({ ok: true }));

    await app.ready();
    const response = await app.inject({
      method: 'GET',
      url: '/test',
      headers: {
        'x-request-id': 'req-header-test',
        'x-correlation-id': 'corr-header-test',
      },
    });

    expect(response.headers['x-request-id']).toBe('req-header-test');
    expect(response.headers['x-correlation-id']).toBe('corr-header-test');
  });

  it('should attach a request logger to the request object', async () => {
    await app.register(loggingPlugin);

    let hasLogger = false;
    app.get('/test', async (request) => {
      hasLogger = typeof request.requestLog?.info === 'function';
      return { ok: true };
    });

    await app.ready();
    await app.inject({ method: 'GET', url: '/test' });

    expect(hasLogger).toBe(true);
  });

  it('should support custom request ID header name', async () => {
    await app.register(loggingPlugin, {
      requestIdHeader: 'x-custom-request-id',
    });

    let capturedRequestId = '';
    app.get('/test', async (request) => {
      capturedRequestId = request.reqId;
      return { ok: true };
    });

    await app.ready();
    await app.inject({
      method: 'GET',
      url: '/test',
      headers: { 'x-custom-request-id': 'custom-header-req' },
    });

    expect(capturedRequestId).toBe('custom-header-req');
  });

  it('should support custom correlation ID header name', async () => {
    await app.register(loggingPlugin, {
      correlationIdHeader: 'x-trace-id',
    });

    let capturedCorrelationId = '';
    app.get('/test', async (request) => {
      capturedCorrelationId = request.correlationId;
      return { ok: true };
    });

    await app.ready();
    await app.inject({
      method: 'GET',
      url: '/test',
      headers: { 'x-trace-id': 'trace-789' },
    });

    expect(capturedCorrelationId).toBe('trace-789');
  });

  it('should skip logging for ignored paths', async () => {
    await app.register(loggingPlugin, {
      ignorePaths: ['/health'],
    });

    app.get('/health', async () => ({ status: 'ok' }));

    await app.ready();
    const response = await app.inject({ method: 'GET', url: '/health' });

    // Should still work, just not log
    expect(response.statusCode).toBe(200);
  });

  it('should attach tenant ID to logger when available on request', async () => {
    // Simulate tenant resolution happening before logging plugin
    app.decorateRequest('tenantId', '');
    app.addHook('onRequest', async (request) => {
      (request as any).tenantId = 'tenant-xyz';
    });

    await app.register(loggingPlugin);

    let loggerBindings: Record<string, unknown> = {};
    app.get('/test', async (request) => {
      loggerBindings = (request.requestLog as any).bindings?.() || {};
      return { ok: true };
    });

    await app.ready();
    await app.inject({ method: 'GET', url: '/test' });

    expect(loggerBindings['tenant_id']).toBe('tenant-xyz');
  });

  it('should handle requests with different HTTP methods', async () => {
    await app.register(loggingPlugin);

    app.post('/data', async () => ({ created: true }));
    app.put('/data/:id', async () => ({ updated: true }));
    app.delete('/data/:id', async () => ({ deleted: true }));

    await app.ready();

    const postRes = await app.inject({ method: 'POST', url: '/data', payload: {} });
    expect(postRes.statusCode).toBe(200);

    const putRes = await app.inject({ method: 'PUT', url: '/data/1', payload: {} });
    expect(putRes.statusCode).toBe(200);

    const deleteRes = await app.inject({ method: 'DELETE', url: '/data/1' });
    expect(deleteRes.statusCode).toBe(200);
  });
});
