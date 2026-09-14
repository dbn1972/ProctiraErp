/**
 * Integration tests for the Fastify observability plugin. These confirm
 * that the /metrics endpoint is exposed, requests are counted, and
 * histograms record latency. W1-SEC-07 covers access guard + cardinality.
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
      // Tests run under vitest (non-production); keep open for legacy cases.
      metricsAccessEnv: { NODE_ENV: 'test' },
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

  it('does not emit raw tenant_id on default HTTP metrics (W1-SEC-07 cardinality)', async () => {
    await app.inject({ method: 'GET', url: '/hello' });
    const res = await app.inject({ method: 'GET', url: '/metrics' });
    expect(res.body).toContain('http_requests_total{');
    expect(res.body).not.toMatch(/http_requests_total\{[^}]*tenant_id=/);
    expect(res.body).not.toMatch(/tenant_id=/);
  });

  it('decorates the fastify instance with a metrics registry', () => {
    expect(app.metrics).toBeInstanceOf(MetricsRegistry);
    expect(app.metrics.serviceName).toBe('test-svc');
  });
});

describe('observabilityPlugin /metrics guard (W1-SEC-07)', () => {
  it('rejects unauthenticated remote scrapes in production when unset', async () => {
    const app = Fastify();
    await app.register(observabilityPlugin, {
      serviceName: 'prod-svc',
      collectDefaultMetrics: false,
      metricsAccessEnv: { NODE_ENV: 'production' },
    });
    await app.ready();

    // Fastify inject defaults to 127.0.0.1 (loopback) — still allowed.
    const loopback = await app.inject({ method: 'GET', url: '/metrics' });
    expect(loopback.statusCode).toBe(200);

    // Simulate a remote peer via remoteAddress on the inject options.
    const remote = await app.inject({
      method: 'GET',
      url: '/metrics',
      remoteAddress: '203.0.113.10',
    });
    expect(remote.statusCode).toBe(403);
    await app.close();
  });

  it('accepts Bearer token when METRICS_BEARER_TOKEN is configured', async () => {
    const app = Fastify();
    await app.register(observabilityPlugin, {
      serviceName: 'token-svc',
      collectDefaultMetrics: false,
      metricsAccessEnv: {
        NODE_ENV: 'production',
        METRICS_BEARER_TOKEN: 'prometheus-scrape',
      },
    });
    await app.ready();

    const denied = await app.inject({
      method: 'GET',
      url: '/metrics',
      remoteAddress: '10.0.0.8',
    });
    expect(denied.statusCode).toBe(401);

    const ok = await app.inject({
      method: 'GET',
      url: '/metrics',
      remoteAddress: '10.0.0.8',
      headers: { authorization: 'Bearer prometheus-scrape' },
    });
    expect(ok.statusCode).toBe(200);
    expect(ok.body).toContain('http_requests_in_flight');
    await app.close();
  });

  it('honours METRICS_ALLOWLIST for production scrapes', async () => {
    const app = Fastify();
    await app.register(observabilityPlugin, {
      serviceName: 'allow-svc',
      collectDefaultMetrics: false,
      metricsAccessEnv: {
        NODE_ENV: 'production',
        METRICS_ALLOWLIST: '10.0.0.50',
      },
    });
    await app.ready();

    const denied = await app.inject({
      method: 'GET',
      url: '/metrics',
      remoteAddress: '10.0.0.99',
    });
    expect(denied.statusCode).toBe(403);

    const ok = await app.inject({
      method: 'GET',
      url: '/metrics',
      remoteAddress: '10.0.0.50',
    });
    expect(ok.statusCode).toBe(200);
    await app.close();
  });

  it('allows METRICS_PUBLIC=1 escape hatch', async () => {
    const app = Fastify();
    await app.register(observabilityPlugin, {
      serviceName: 'public-svc',
      collectDefaultMetrics: false,
      metricsAccessEnv: {
        NODE_ENV: 'production',
        METRICS_PUBLIC: '1',
      },
    });
    await app.ready();
    const res = await app.inject({
      method: 'GET',
      url: '/metrics',
      remoteAddress: '203.0.113.1',
    });
    expect(res.statusCode).toBe(200);
    await app.close();
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
