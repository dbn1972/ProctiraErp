/**
 * W1-SEC-02 (D2) — health API negative authz (PHI-aware deny at gateway stack).
 *
 * Portal roles must not read health aggregates or PHI audit metadata even when
 * coarse RBAC grants `health.read`; domain / UI plugins enforce personnel-only.
 */
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import type { FastifyInstance } from 'fastify';

import { buildApp } from './app.js';
import type { GatewayConfig } from './config.js';

delete process.env['DATABASE_URL'];

const TENANT_ID = '550e8400-e29b-41d4-a716-446655440000';

function createTestConfig(): GatewayConfig {
  return {
    port: 0,
    host: '127.0.0.1',
    env: 'test',
    rateLimiting: { windowMs: 60000, maxRequests: 1000 },
    cors: {
      origins: ['http://localhost:3000'],
      methods: ['GET', 'POST', 'PUT', 'PATCH', 'DELETE', 'OPTIONS'],
      credentials: true,
    },
    jwt: {
      secret: 'test-secret-key-for-testing-only',
      issuer: 'proctira-test',
      audience: 'proctira-test-api',
      accessTokenExpiresIn: '15m',
    },
    tenant: { baseDomain: 'proctira.org', headerName: 'x-tenant-id' },
    services: {
      auth: { prefix: '/auth', target: 'http://127.0.0.1:1', healthCheck: '/health' },
    },
  };
}

function bearer(app: FastifyInstance, roleId: string) {
  return app.jwt.sign({
    sub: `${roleId}-user`,
    tenantId: TENANT_ID,
    email: `${roleId}@test.com`,
    displayName: roleId,
    roles: [{ roleId, roleName: roleId, areaId: 'root' }],
    areas: [],
    institutions: [],
    jti: `jti-${roleId}`,
    sessionId: `sess-${roleId}`,
  });
}

describe('W1-SEC-02 (D2) health route authz', () => {
  let app: FastifyInstance;

  beforeAll(async () => {
    app = await buildApp({ config: createTestConfig() });
    await app.ready();
  });

  afterAll(async () => {
    await app.close();
  });

  const DENIED_ROLES = ['parent', 'teacher', 'student'] as const;

  for (const roleId of DENIED_ROLES) {
    it(`${roleId} → 403 on GET /api/v1/health/records (PHI aggregate)`, async () => {
      const response = await app.inject({
        method: 'GET',
        url: '/api/v1/health/records',
        headers: {
          authorization: `Bearer ${bearer(app, roleId)}`,
          'x-tenant-id': TENANT_ID,
        },
      });
      expect(response.statusCode).toBe(403);
    });

    it(`${roleId} → 403 on GET /api/v1/health/phi-access (PHI audit metadata)`, async () => {
      const response = await app.inject({
        method: 'GET',
        url: '/api/v1/health/phi-access',
        headers: {
          authorization: `Bearer ${bearer(app, roleId)}`,
          'x-tenant-id': TENANT_ID,
        },
      });
      expect(response.statusCode).toBe(403);
    });
  }

  it('nurse → 403 on GET /api/v1/health/phi-access (stricter than records)', async () => {
    const response = await app.inject({
      method: 'GET',
      url: '/api/v1/health/phi-access',
      headers: {
        authorization: `Bearer ${bearer(app, 'nurse')}`,
        'x-tenant-id': TENANT_ID,
      },
    });
    expect(response.statusCode).toBe(403);
  });

  it('nurse passes RBAC gate on GET /api/v1/health/records', async () => {
    const response = await app.inject({
      method: 'GET',
      url: '/api/v1/health/records',
      headers: {
        authorization: `Bearer ${bearer(app, 'nurse')}`,
        'x-tenant-id': TENANT_ID,
      },
    });
    expect(response.statusCode).not.toBe(403);
    expect(response.statusCode).not.toBe(401);
  });
});
