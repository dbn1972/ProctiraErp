/**
 * PRC-M023 — /api/v1/storage/health is not anonymous, defaults to a read-only
 * probe and never returns raw storage error text.
 */
import type { FastifyInstance } from 'fastify';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';

import { authHeaders, createTestConfig } from './__tests__/gateway-test-kit.js';
import { buildApp } from './app.js';

delete process.env['DATABASE_URL'];

describe('storage health exposure (PRC-M023)', () => {
  let app: FastifyInstance;
  beforeAll(async () => {
    app = await buildApp({ config: createTestConfig() });
    await app.ready();
  });
  afterAll(async () => {
    await app.close();
  });

  it('anonymous request is rejected', async () => {
    const res = await app.inject({ method: 'GET', url: '/api/v1/storage/health' });
    expect([401, 403]).toContain(res.statusCode);
  });

  it('non-platform user is rejected', async () => {
    const res = await app.inject({
      method: 'GET',
      url: '/api/v1/storage/health',
      headers: authHeaders(app, { roles: ['teacher'] }),
    });
    expect(res.statusCode).toBe(403);
  });

  it('platform admin reaches the probe', async () => {
    const res = await app.inject({
      method: 'GET',
      url: '/api/v1/storage/health',
      headers: authHeaders(app, { roles: ['super-admin'] }),
    });
    expect([200, 503]).toContain(res.statusCode);
  });
});
