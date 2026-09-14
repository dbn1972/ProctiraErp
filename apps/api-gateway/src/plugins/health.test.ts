/**
 * W1-OPS-03 / W3-C1 — gateway readiness must probe critical deps and fail closed.
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
    delete process.env['REDIS_URL'];
  });

  it('reports in-memory database and not-configured redis when unset in test', async () => {
    const result = await runReadinessProbe({ env: { NODE_ENV: 'test' } });
    expect(result.ready).toBe(true);
    expect(result.dependencies.database).toBe('in-memory');
    expect(result.dependencies.redis).toBe('not-configured');
    expect(Object.values(result.dependencies)).not.toContain('unknown');
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

  it('W1-SEC-12: fails closed in production even when ALLOW_IN_MEMORY_IN_PRODUCTION=1', async () => {
    const result = await runReadinessProbe({
      env: { NODE_ENV: 'production', ALLOW_IN_MEMORY_IN_PRODUCTION: '1' },
    });
    expect(result.ready).toBe(false);
    expect(result.dependencies.database).toBe('required-missing');
    expect(result.message).toMatch(/ALLOW_IN_MEMORY_IN_PRODUCTION is disabled/);
  });

  it('fails closed when REDIS_URL is set but probe fails', async () => {
    const result = await runReadinessProbe({
      env: { NODE_ENV: 'test', REDIS_URL: 'redis://127.0.0.1:6379' },
      probeRedis: async () => ({ ok: false, message: 'ECONNREFUSED', latencyMs: 3 }),
    });
    expect(result.ready).toBe(false);
    expect(result.dependencies.redis).toBe('down');
    expect(result.message).toMatch(/ECONNREFUSED/);
  });

  it('passes when REDIS_URL is set and probe succeeds', async () => {
    const result = await runReadinessProbe({
      env: { NODE_ENV: 'test', REDIS_URL: 'redis://127.0.0.1:6379' },
      probeRedis: async () => ({ ok: true, latencyMs: 2 }),
    });
    expect(result.ready).toBe(true);
    expect(result.dependencies.redis).toBe('up');
  });

  it('fails closed when DB is up but Redis is down', async () => {
    const result = await runReadinessProbe({
      env: {
        NODE_ENV: 'production',
        DATABASE_URL: 'postgres://good:5432/x',
        REDIS_URL: 'redis://127.0.0.1:6379',
      },
      probeDatabase: async () => ({ ok: true, latencyMs: 4 }),
      probeRedis: async () => ({ ok: false, message: 'Redis unavailable', latencyMs: 2 }),
    });
    expect(result.ready).toBe(false);
    expect(result.dependencies.database).toBe('up');
    expect(result.dependencies.redis).toBe('down');
  });
});

describe('GET /health/ready (W1-OPS-03 / W3-C1)', () => {
  async function mount(
    options?: Parameters<typeof healthPlugin>[1] & {
      probeDatabase?: () => Promise<{ ok: boolean; message?: string; latencyMs?: number }>;
      probeRedis?: () => Promise<{ ok: boolean; message?: string; latencyMs?: number }>;
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
    delete process.env['REDIS_URL'];
  });

  it('returns 200 with real dependency statuses (not unknown) in in-memory mode', async () => {
    const app = await mount();
    const res = await app.inject({ method: 'GET', url: '/health/ready' });
    expect(res.statusCode).toBe(200);
    const body = res.json() as ReadinessProbeResult & { status: string };
    expect(body.status).toBe('up');
    expect(body.dependencies.database).toBe('in-memory');
    expect(body.dependencies.redis).toBe('not-configured');
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
      dependencies: { database: 'down', redis: 'not-configured' },
    });
    await app.close();
  });

  it('returns 503 when redis probe fails (fail closed)', async () => {
    const app = await mount({
      probeRedis: async () => ({ ok: false, message: 'ECONNREFUSED', latencyMs: 1 }),
      env: { NODE_ENV: 'test', REDIS_URL: 'redis://127.0.0.1:6379' },
    });
    const res = await app.inject({ method: 'GET', url: '/health/ready' });
    expect(res.statusCode).toBe(503);
    expect(res.json()).toMatchObject({
      status: 'down',
      dependencies: { database: 'in-memory', redis: 'down' },
    });
    await app.close();
  });

  it('returns 200 with database/redis up when probes succeed (healthy path)', async () => {
    const app = await mount({
      probeDatabase: async () => ({ ok: true, latencyMs: 3 }),
      probeRedis: async () => ({ ok: true, latencyMs: 2 }),
      env: {
        NODE_ENV: 'production',
        DATABASE_URL: 'postgres://good:5432/x',
        REDIS_URL: 'redis://127.0.0.1:6379',
      },
    });
    const res = await app.inject({ method: 'GET', url: '/health/ready' });
    expect(res.statusCode).toBe(200);
    expect(res.json()).toMatchObject({
      status: 'up',
      dependencies: { database: 'up', redis: 'up' },
    });
    expect(Object.values((res.json() as ReadinessProbeResult).dependencies)).not.toContain(
      'unknown',
    );
    await app.close();
  });

  it('GET /health returns 503 when readiness is down (Dockerfile HEALTHCHECK fail-closed)', async () => {
    const app = await mount({
      probeDatabase: async () => ({ ok: false, message: 'ECONNREFUSED', latencyMs: 1 }),
      env: { NODE_ENV: 'production', DATABASE_URL: 'postgres://x' },
    });
    const res = await app.inject({ method: 'GET', url: '/health' });
    expect(res.statusCode).toBe(503);
    const body = res.json() as {
      status: string;
      checks: { readiness: { status: string; details?: Record<string, string> } };
    };
    expect(body.status).toBe('unhealthy');
    expect(body.checks.readiness.status).toBe('down');
    expect(body.checks.readiness.details?.database).toBe('down');
    expect(body.checks.readiness.details?.redis).toBe('not-configured');
    await app.close();
  });

  it('GET /health returns 200 healthy when probes succeed', async () => {
    const app = await mount({
      probeDatabase: async () => ({ ok: true, latencyMs: 2 }),
      probeRedis: async () => ({ ok: true, latencyMs: 1 }),
      env: {
        NODE_ENV: 'production',
        DATABASE_URL: 'postgres://good:5432/x',
        REDIS_URL: 'redis://127.0.0.1:6379',
      },
    });
    const res = await app.inject({ method: 'GET', url: '/health' });
    expect(res.statusCode).toBe(200);
    const body = res.json() as {
      status: string;
      checks: { readiness: { status: string; details?: Record<string, string> } };
    };
    expect(body.status).toBe('healthy');
    expect(body.checks.readiness.status).toBe('up');
    expect(body.checks.readiness.details?.database).toBe('up');
    expect(body.checks.readiness.details?.redis).toBe('up');
    await app.close();
  });

  it('GET /health/live stays cheap (no dependency probe)', async () => {
    const dbProbe = vi.fn(async () => ({ ok: false, message: 'should not run', latencyMs: 0 }));
    const redisProbe = vi.fn(async () => ({ ok: false, message: 'should not run', latencyMs: 0 }));
    const app = await mount({
      probeDatabase: dbProbe,
      probeRedis: redisProbe,
      env: { NODE_ENV: 'production', DATABASE_URL: 'postgres://x', REDIS_URL: 'redis://x' },
    });
    const res = await app.inject({ method: 'GET', url: '/health/live' });
    expect(res.statusCode).toBe(200);
    expect(res.json()).toEqual({ status: 'up' });
    expect(dbProbe).not.toHaveBeenCalled();
    expect(redisProbe).not.toHaveBeenCalled();
    await app.close();
  });
});
