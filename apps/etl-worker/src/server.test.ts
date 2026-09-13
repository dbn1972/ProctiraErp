/**
 * W1-OPS-02 (B4) / P0-10 — ETL worker health probes align with k8s/helm.
 *
 * Deploy manifests probe `/health/live` (liveness) and `/health/ready` (readiness).
 * Gateway probes are unchanged; this suite guards etl-worker handler parity only.
 */
import { InMemoryPipelineRepository } from '@proctira/backend-etl';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';

import { buildEtlWorkerApp } from './server.js';

/** Paths wired in infrastructure/k8s/base/etl-worker and Helm etlWorker.*Probe. */
export const ETL_WORKER_K8S_PROBE_PATHS = {
  liveness: '/health/live',
  readiness: '/health/ready',
  legacy: '/health',
} as const;

describe('etl-worker health probes (W1-OPS-02 B4)', () => {
  const apps: Array<Awaited<ReturnType<typeof buildEtlWorkerApp>>> = [];
  const prevLog = process.env.LOG_LEVEL;

  beforeEach(() => {
    process.env.LOG_LEVEL = 'silent';
  });

  afterEach(async () => {
    if (prevLog === undefined) delete process.env.LOG_LEVEL;
    else process.env.LOG_LEVEL = prevLog;
    while (apps.length > 0) {
      const app = apps.pop();
      if (app) await app.close();
    }
  });

  async function app() {
    const instance = await buildEtlWorkerApp({
      repository: new InMemoryPipelineRepository(),
    });
    apps.push(instance);
    return instance;
  }

  it('GET /health returns 200 (compat)', async () => {
    const response = await (await app()).inject({ method: 'GET', url: '/health' });
    expect(response.statusCode).toBe(200);
    expect(response.json()).toMatchObject({ status: 'ok', service: 'etl-worker' });
  });

  it('GET /health/live returns 200 (k8s liveness)', async () => {
    const response = await (await app()).inject({
      method: 'GET',
      url: ETL_WORKER_K8S_PROBE_PATHS.liveness,
    });
    expect(response.statusCode).toBe(200);
    expect(response.json()).toMatchObject({ status: 'up', service: 'etl-worker' });
  });

  it('GET /health/ready returns 200 with persistence mode (k8s readiness)', async () => {
    const response = await (await app()).inject({
      method: 'GET',
      url: ETL_WORKER_K8S_PROBE_PATHS.readiness,
    });
    expect(response.statusCode).toBe(200);
    const body = response.json() as { status: string; persistence: string };
    expect(body.status).toBe('up');
    expect(['postgres', 'memory']).toContain(body.persistence);
  });
});
