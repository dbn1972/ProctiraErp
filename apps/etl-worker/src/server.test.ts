/**
 * P0-10 — ETL worker health probes align with k8s/helm (/health/live, /health/ready).
 */
import { InMemoryPipelineRepository } from '@proctira/backend-etl';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';

import { buildEtlWorkerApp } from './server.js';

describe('etl-worker health probes (P0-10)', () => {
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

  it('GET /health/live returns 200', async () => {
    const response = await (await app()).inject({ method: 'GET', url: '/health/live' });
    expect(response.statusCode).toBe(200);
    expect(response.json()).toMatchObject({ status: 'up', service: 'etl-worker' });
  });

  it('GET /health/ready returns 200 with persistence mode', async () => {
    const response = await (await app()).inject({ method: 'GET', url: '/health/ready' });
    expect(response.statusCode).toBe(200);
    const body = response.json() as { status: string; persistence: string };
    expect(body.status).toBe('up');
    expect(['postgres', 'memory']).toContain(body.persistence);
  });
});
