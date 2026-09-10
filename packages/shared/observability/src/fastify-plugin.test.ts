/**
 * Integration tests for the Fastify observability plugin. These confirm
 * that the /metrics endpoint is exposed, requests are counted, and
 * histograms record latency.
 */
import { describe, expect, it, beforeEach, afterEach } from 'vitest';
import Fastify, { type FastifyInstance } from 'fastify';

import { observabilityPlugin } from './fastify-plugin.js';
import { MetricsRegistry } from './metrics-registry.js';

describe('observabilityPlugin', () => {
  let app: FastifyInstance;

  beforeEach(async () => {
    app = Fastify();
    const registry = new MetricsRegistry('test-svc');
    await app.register(observabilityPlugin, {
      serviceName: 'test-svc',
      registry,
      collectDefaultMetrics: false,
    });
    app.get('/hello', async () => ({ ok: true }));
    app.get('/boom', async () => {
      throw new Error('boom');
    });
    await app.ready();
  });

  afterEach(async () => {
    await app.close();
  });

  it('exposes /metrics in Prometheus text format', async () => {
    const res = await app.inject({ method: 'GET', url: '/metrics' });
    expect(res.statusCode).toBe(200);
    expect(res.headers['content-type']).toMatch(/text\/plain/);
    expect(res.body).toContain('http_requests_in_flight');
  });

  it('counts successful requests', async () => {
    await app.inject({ method: 'GET', url: '/hello' });
    await app.inject({ method: 'GET', url: '/hello' });
    const res = await app.inject({ method: 'GET', url: '/metrics' });
    expect(res.body).toContain('http_requests_total');
    expect(res.body).toMatch(
      /http_requests_total\{[^}]*route="\/hello"[^}]*status_code="200"[^}]*\} 2/,
    );
  });

  it('records request duration histogram', async () => {
    await app.inject({ method: 'GET', url: '/hello' });
    const res = await app.inject({ method: 'GET', url: '/metrics' });
    expect(res.body).toContain('http_request_duration_seconds_bucket');
    expect(res.body).toContain('http_request_duration_seconds_count');
  });

  it('records 5xx requests with the correct status_code label', async () => {
    await app.inject({ method: 'GET', url: '/boom' });
    const res = await app.inject({ method: 'GET', url: '/metrics' });
    expect(res.body).toMatch(/http_requests_total\{[^}]*status_code="500"/);
  });

  it('uses unknown for tenant_id when no tenant is attached', async () => {
    await app.inject({ method: 'GET', url: '/hello' });
    const res = await app.inject({ method: 'GET', url: '/metrics' });
    expect(res.body).toMatch(/http_requests_total\{[^}]*tenant_id="unknown"/);
  });

  it('decorates the fastify instance with a metrics registry', () => {
    expect(app.metrics).toBeInstanceOf(MetricsRegistry);
    expect(app.metrics.serviceName).toBe('test-svc');
  });
});

describe('observabilityPlugin enabled switch (G-725)', () => {
  it('registers no /metrics route when enabled=false but still decorates fastify.metrics', async () => {
    const app = Fastify();
    await app.register(observabilityPlugin, { serviceName: 'off-svc', enabled: false });
    app.get('/ping', async () => ({ ok: true }));
    await app.ready();

    expect(app.metrics).toBeDefined();
    const res = await app.inject({ method: 'GET', url: '/metrics' });
    expect(res.statusCode).toBe(404);
    await app.close();
  });

  it('honours METRICS_ENABLED=false from the environment by default', async () => {
    const prev = process.env['METRICS_ENABLED'];
    process.env['METRICS_ENABLED'] = 'false';
    try {
      const app = Fastify();
      await app.register(observabilityPlugin, { serviceName: 'env-off' });
      await app.ready();
      const res = await app.inject({ method: 'GET', url: '/metrics' });
      expect(res.statusCode).toBe(404);
      await app.close();
    } finally {
      if (prev === undefined) delete process.env['METRICS_ENABLED'];
      else process.env['METRICS_ENABLED'] = prev;
    }
  });
});
