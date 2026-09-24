/**
 * W1-OPS-03 / W3-C1 — gateway readiness must probe critical deps and fail closed.
 */
import Fastify from 'fastify';
import { afterEach, describe, expect, it, vi } from 'vitest';

import healthPlugin, {
  GATEWAY_SCHEMA_READINESS_RELATIONS,
  runReadinessProbe,
  type ReadinessProbeResult,
} from './health.js';

describe('runReadinessProbe', () => {
  afterEach(() => {
    delete process.env['DATABASE_URL'];
    delete process.env['REQUIRE_DATABASE'];
    delete process.env['NODE_ENV'];
    delete process.env['ALLOW_IN_MEMORY_IN_PRODUCTION'];
    delete process.env['REDIS_URL'];
  });

  it('covers every centralized raw-PG relation in the default database probe', () => {
    expect(GATEWAY_SCHEMA_READINESS_RELATIONS).toContain('public.parent_consents');
    expect(GATEWAY_SCHEMA_READINESS_RELATIONS).toContain('public.hostel_assignments');
    expect(new Set(GATEWAY_SCHEMA_READINESS_RELATIONS).size).toBe(
      GATEWAY_SCHEMA_READINESS_RELATIONS.length,
    );
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

/**
 * V15 — `/health` and `/health/ready` are in `authExcludePaths` because container and
 * Kubernetes probes cannot authenticate, so whatever they return is world-readable.
 *
 * Reproduced before the fix, with failing probes in production posture:
 *
 *   {"status":"down","dependencies":{...},"message":"relation \"public.audit_events\"
 *    does not exist (host=db-prod-1.internal db=proctira_prod); connect ETIMEDOUT
 *    cache-prod-2.internal"}
 *
 * The per-dependency statuses are what a probe consumer needs and they name nothing;
 * only the free-text detail is withheld, and only outside development.
 */
describe('anonymous readiness endpoints do not disclose dependency internals (V15)', () => {
  const LEAKY_DB =
    'relation "public.audit_events" does not exist (host=db-prod-1.internal db=proctira_prod)';
  const LEAKY_REDIS = 'connect ETIMEDOUT cache-prod-2.internal';

  async function mountFailing(nodeEnv: string) {
    const app = Fastify();
    await app.register(healthPlugin, {
      services: {
        auth: { prefix: '/auth', target: 'http://127.0.0.1:1', healthCheck: '/health' },
      },
      env: {
        NODE_ENV: nodeEnv,
        DATABASE_URL: 'postgresql://u:p@db-prod-1.internal:5432/proctira_prod',
        REDIS_URL: 'redis://cache-prod-2.internal:6379',
      },
      probeDatabase: async () => ({ ok: false, message: LEAKY_DB }),
      probeRedis: async () => ({ ok: false, message: LEAKY_REDIS }),
    } as Parameters<typeof healthPlugin>[1]);
    await app.ready();
    return app;
  }

  it('/health/ready withholds the probe text but keeps the statuses', async () => {
    const app = await mountFailing('production');
    const res = await app.inject({ method: 'GET', url: '/health/ready' });

    expect(res.statusCode).toBe(503);
    expect(res.body).not.toContain('db-prod-1.internal');
    expect(res.body).not.toContain('proctira_prod');
    expect(res.body).not.toContain('audit_events');
    expect(res.body).not.toContain('cache-prod-2.internal');
    // The useful, non-sensitive part survives.
    expect(res.json()).toMatchObject({
      status: 'down',
      dependencies: { database: 'down', redis: 'down' },
    });
    await app.close();
  });

  it('/health withholds the probe text but keeps the statuses', async () => {
    const app = await mountFailing('production');
    const res = await app.inject({ method: 'GET', url: '/health' });

    expect(res.statusCode).toBe(503);
    expect(res.body).not.toContain('db-prod-1.internal');
    expect(res.body).not.toContain('audit_events');
    expect(res.json().checks.readiness.details).toMatchObject({
      database: 'down',
      redis: 'down',
    });
    await app.close();
  });

  it('development still shows the probe text', async () => {
    // Withholding it locally would just make a broken dev database harder to diagnose.
    const app = await mountFailing('development');
    const res = await app.inject({ method: 'GET', url: '/health/ready' });
    expect(res.json().message).toContain('db-prod-1.internal');
    await app.close();
  });

  it('runReadinessProbe still returns the detail to in-process callers', async () => {
    // The redaction belongs to the HTTP boundary, not the probe: logs and tests must keep
    // the real reason.
    const result = await runReadinessProbe({
      env: {
        NODE_ENV: 'production',
        DATABASE_URL: 'postgresql://u:p@db-prod-1.internal:5432/proctira_prod',
      },
      probeDatabase: async () => ({ ok: false, message: LEAKY_DB }),
    });
    expect(result.ready).toBe(false);
    expect(result.message).toContain('db-prod-1.internal');
  });
});
