/**
 * W1-OPS-02 (B4) / P0-10 / W3-C2 — ETL worker health probes align with k8s/helm.
 *
 * Deploy manifests probe `/health/live` (liveness) and `/health/ready` (readiness).
 * Readiness must probe Postgres when configured and fail closed when unavailable.
 * Gateway probes are unchanged; this suite guards etl-worker handler parity only.
 */
import { InMemoryPipelineRepository } from '@proctira/backend-etl';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { buildEtlWorkerApp } from './server.js';

/** Paths wired in infrastructure/k8s/base/etl-worker and Helm etlWorker.*Probe. */
export const ETL_WORKER_K8S_PROBE_PATHS = {
  liveness: '/health/live',
  readiness: '/health/ready',
  legacy: '/health',
} as const;

describe('etl-worker health probes (W1-OPS-02 B4 / W3-C2)', () => {
  const apps: Array<Awaited<ReturnType<typeof buildEtlWorkerApp>>> = [];
  const prevLog = process.env.LOG_LEVEL;

  beforeEach(() => {
    process.env.LOG_LEVEL = 'silent';
  });

  afterEach(async () => {
    if (prevLog === undefined) delete process.env.LOG_LEVEL;
    else process.env.LOG_LEVEL = prevLog;
    delete process.env['DATABASE_URL'];
    delete process.env['REQUIRE_DATABASE'];
    delete process.env['NODE_ENV'];
    delete process.env['ALLOW_IN_MEMORY_IN_PRODUCTION'];
    while (apps.length > 0) {
      const app = apps.pop();
      if (app) await app.close();
    }
  });

  async function app(
    options: Parameters<typeof buildEtlWorkerApp>[0] = {},
  ) {
    const instance = await buildEtlWorkerApp({
      repository: new InMemoryPipelineRepository(),
      ...options,
    });
    apps.push(instance);
    return instance;
  }

  it('GET /health returns 200 (compat) in in-memory mode', async () => {
    const response = await (await app()).inject({ method: 'GET', url: '/health' });
    expect(response.statusCode).toBe(200);
    expect(response.json()).toMatchObject({
      status: 'ok',
      service: 'etl-worker',
      dependencies: { database: 'in-memory' },
    });
  });

  it('GET /health/live returns 200 (k8s liveness)', async () => {
    const response = await (await app()).inject({
      method: 'GET',
      url: ETL_WORKER_K8S_PROBE_PATHS.liveness,
    });
    expect(response.statusCode).toBe(200);
    expect(response.json()).toMatchObject({ status: 'up', service: 'etl-worker' });
  });

  it('GET /health/ready returns 200 with persistence mode (k8s readiness, in-memory)', async () => {
    const response = await (await app()).inject({
      method: 'GET',
      url: ETL_WORKER_K8S_PROBE_PATHS.readiness,
    });
    expect(response.statusCode).toBe(200);
    const body = response.json() as {
      status: string;
      persistence: string;
      dependencies: { database: string };
    };
    expect(body.status).toBe('up');
    expect(body.persistence).toBe('memory');
    expect(body.dependencies.database).toBe('in-memory');
  });

  it('GET /health/ready returns 503 when DATABASE_URL is set but probe fails (fail closed)', async () => {
    const response = await (
      await app({
        env: { NODE_ENV: 'production', DATABASE_URL: 'postgres://bad:5432/x' },
        probeDatabase: async () => ({ ok: false, message: 'ECONNREFUSED', latencyMs: 1 }),
      })
    ).inject({
      method: 'GET',
      url: ETL_WORKER_K8S_PROBE_PATHS.readiness,
    });
    expect(response.statusCode).toBe(503);
    expect(response.json()).toMatchObject({
      status: 'down',
      service: 'etl-worker',
      persistence: 'postgres',
      dependencies: { database: 'down' },
    });
  });

  it('GET /health/ready returns 200 when DATABASE_URL is set and probe succeeds', async () => {
    const response = await (
      await app({
        env: { NODE_ENV: 'production', DATABASE_URL: 'postgres://good:5432/x' },
        probeDatabase: async () => ({ ok: true, latencyMs: 3 }),
      })
    ).inject({
      method: 'GET',
      url: ETL_WORKER_K8S_PROBE_PATHS.readiness,
    });
    expect(response.statusCode).toBe(200);
    expect(response.json()).toMatchObject({
      status: 'up',
      persistence: 'postgres',
      dependencies: { database: 'up' },
      latencyMs: 3,
    });
  });

  it('GET /health/ready fails closed in production without DATABASE_URL', async () => {
    const response = await (
      await app({
        env: { NODE_ENV: 'production' },
      })
    ).inject({
      method: 'GET',
      url: ETL_WORKER_K8S_PROBE_PATHS.readiness,
    });
    expect(response.statusCode).toBe(503);
    expect(response.json()).toMatchObject({
      status: 'down',
      dependencies: { database: 'required-missing' },
    });
  });

  it('GET /health/live stays cheap (no dependency probe)', async () => {
    const probe = vi.fn(async () => ({ ok: false, message: 'should not run', latencyMs: 0 }));
    const response = await (
      await app({
        env: { NODE_ENV: 'production', DATABASE_URL: 'postgres://x' },
        probeDatabase: probe,
      })
    ).inject({
      method: 'GET',
      url: ETL_WORKER_K8S_PROBE_PATHS.liveness,
    });
    expect(response.statusCode).toBe(200);
    expect(probe).not.toHaveBeenCalled();
  });
});
