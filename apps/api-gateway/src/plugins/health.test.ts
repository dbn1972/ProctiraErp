/**
 * W1-OPS-03 (B5) — gateway readiness must probe critical deps and fail closed.
 */
import Fastify from 'fastify';
import { afterEach, describe, expect, it, vi } from 'vitest';

import healthPlugin, { runReadinessProbe, type ReadinessProbeResult } from './health.js';

describe('runReadinessProbe', () => {
  afterEach(() => {
    delete process.env['DATABASE_URL'];
    delete process.env['REQUIRE_DATABASE'];
    delete process.env['NODE_ENV'];
    delete process.env['ALLOW_IN_MEMORY_IN_PRODUCTION'];
  });

  it('reports in-memory when DATABASE_URL is unset in test', async () => {
    const result = await runReadinessProbe({ env: { NODE_ENV: 'test' } });
    expect(result.ready).toBe(true);
    expect(result.dependencies.database).toBe('in-memory');
    expect(result.dependencies.database).not.toBe('unknown');
  });

  it('fails closed when DATABASE_URL is set but probe fails', async () => {
    const result = await runReadinessProbe({
      env: { NODE_ENV: 'production', DATABASE_URL: 'postgres://bad:5432/x' },
      probeDatabase: async () => ({ ok: false, message: 'Connection refused', latencyMs: 12 }),
    });
    expect(result.ready).toBe(false);
    expect(result.dependencies.database).toBe('down');
    expect(result.message).toMatch(/Connection refused/);
  });

  it('passes when DATABASE_URL is set and probe succeeds', async () => {
    const result = await runReadinessProbe({
      env: { NODE_ENV: 'production', DATABASE_URL: 'postgres://good:5432/x' },
      probeDatabase: async () => ({ ok: true, latencyMs: 4 }),
    });
    expect(result.ready).toBe(true);
    expect(result.dependencies.database).toBe('up');
  });

  it('fails closed when REQUIRE_DATABASE=1 but DATABASE_URL is missing', async () => {
    const result = await runReadinessProbe({
      env: { NODE_ENV: 'test', REQUIRE_DATABASE: '1' },
    });
    expect(result.ready).toBe(false);
    expect(result.dependencies.database).toBe('required-missing');
  });

  it('fails closed in production without DATABASE_URL', async () => {
    const result = await runReadinessProbe({
      env: { NODE_ENV: 'production' },
    });
    expect(result.ready).toBe(false);
    expect(result.dependencies.database).toBe('required-missing');
  });
});

describe('GET /health/ready (W1-OPS-03)', () => {
  async function mount(
    options?: Parameters<typeof healthPlugin>[1] & {
      probeDatabase?: () => Promise<{ ok: boolean; message?: string; latencyMs?: number }>;
    },
  ) {
    const app = Fastify();
    await app.register(healthPlugin, {
      services: { auth: { prefix: '/auth', target: 'http://127.0.0.1:1', healthCheck: '/health' } },
      ...options,
    });
    await app.ready();
    return app;
  }

  afterEach(() => {
    delete process.env['DATABASE_URL'];
    delete process.env['REQUIRE_DATABASE'];
    delete process.env['NODE_ENV'];
  });

  it('returns 200 with database dependency (not unknown) in in-memory mode', async () => {
    const app = await mount();
    const res = await app.inject({ method: 'GET', url: '/health/ready' });
    expect(res.statusCode).toBe(200);
    const body = res.json() as ReadinessProbeResult & { status: string };
    expect(body.status).toBe('up');
    expect(body.dependencies.database).toBe('in-memory');
    expect(Object.values(body.dependencies)).not.toContain('unknown');
    await app.close();
  });

  it('returns 503 when database probe fails (fail closed)', async () => {
    const app = await mount({
      probeDatabase: async () => ({ ok: false, message: 'ECONNREFUSED', latencyMs: 1 }),
      env: { NODE_ENV: 'production', DATABASE_URL: 'postgres://x' },
    });
    const res = await app.inject({ method: 'GET', url: '/health/ready' });
    expect(res.statusCode).toBe(503);
    expect(res.json()).toMatchObject({
      status: 'down',
      dependencies: { database: 'down' },
    });
    await app.close();
  });

  it('GET /health/live stays cheap (no dependency probe)', async () => {
    const probe = vi.fn(async () => ({ ok: false, message: 'should not run', latencyMs: 0 }));
    const app = await mount({
      probeDatabase: probe,
      env: { NODE_ENV: 'production', DATABASE_URL: 'postgres://x' },
    });
    const res = await app.inject({ method: 'GET', url: '/health/live' });
    expect(res.statusCode).toBe(200);
    expect(res.json()).toEqual({ status: 'up' });
    expect(probe).not.toHaveBeenCalled();
    await app.close();
  });
});
