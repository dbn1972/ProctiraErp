/**
 * PRC-L493: GET /slo is guarded like /metrics (bearer / allowlist / loopback in production).
 */
import Fastify, { type FastifyInstance } from 'fastify';
import { afterEach, describe, expect, it } from 'vitest';

import { buildServiceSLO, registerServiceSLO } from './slo.js';

const slo = buildServiceSLO({ service: 'svc', owner: 'Engineering' });
const TOKEN = 'test-metrics-token-value';

async function build(accessEnv: Record<string, string>): Promise<FastifyInstance> {
  const app = Fastify();
  registerServiceSLO(app, slo, { accessEnv });
  await app.ready();
  return app;
}

describe('/slo access control (PRC-L493)', () => {
  let app: FastifyInstance | undefined;
  afterEach(async () => {
    await app?.close();
    app = undefined;
  });

  it('returns 401 without the metrics bearer in production', async () => {
    app = await build({ NODE_ENV: 'production', METRICS_BEARER_TOKEN: TOKEN });
    const res = await app.inject({ method: 'GET', url: '/slo' });
    expect(res.statusCode).toBe(401);
    expect(res.body).not.toContain('Engineering');
  });

  it('returns 401 with a wrong bearer in production', async () => {
    app = await build({ NODE_ENV: 'production', METRICS_BEARER_TOKEN: TOKEN });
    const res = await app.inject({
      method: 'GET',
      url: '/slo',
      headers: { authorization: 'Bearer wrong' },
    });
    expect(res.statusCode).toBe(401);
  });

  it('returns 403 for a remote client in production with no token configured', async () => {
    app = await build({ NODE_ENV: 'production' });
    const res = await app.inject({ method: 'GET', url: '/slo', remoteAddress: '10.1.2.3' });
    expect(res.statusCode).toBe(403);
  });

  it('returns the SLO with the correct bearer in production', async () => {
    app = await build({ NODE_ENV: 'production', METRICS_BEARER_TOKEN: TOKEN });
    const res = await app.inject({
      method: 'GET',
      url: '/slo',
      headers: { authorization: `Bearer ${TOKEN}` },
    });
    expect(res.statusCode).toBe(200);
    expect(res.json().service).toBe('svc');
  });

  it('stays open outside production when nothing is configured', async () => {
    app = await build({ NODE_ENV: 'development' });
    const res = await app.inject({ method: 'GET', url: '/slo', remoteAddress: '10.1.2.3' });
    expect(res.statusCode).toBe(200);
  });
});
