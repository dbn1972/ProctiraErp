/**
 * P0-01 / W1-ARCH-05 — production composition must not mount memory-only
 * custom-field or dashboard domains. Privacy remains gateway-composed because
 * it has a durable PostgreSQL repository when DATABASE_URL is configured.
 */
import type { FastifyInstance } from 'fastify';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';

import { buildApp } from './app.js';
import type { GatewayConfig } from './config.js';

delete process.env['DATABASE_URL'];

const TENANT_A = '550e8400-e29b-41d4-a716-446655440000';

function config(): GatewayConfig {
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
      customFields: {
        prefix: '/custom-fields/definitions',
        target: 'http://127.0.0.1:2',
        healthCheck: '/health',
      },
      dashboards: {
        prefix: '/dashboards/',
        target: 'http://127.0.0.1:3',
        healthCheck: '/health',
      },
    },
  };
}

describe('P0-01 production-safe gateway composition', () => {
  let app: FastifyInstance;

  const adminHeaders = (tenantId = TENANT_A) => ({
    authorization: `Bearer ${app.jwt.sign({
      sub: 'admin-1',
      tenantId,
      email: 'admin@example.com',
      displayName: 'Admin',
      roles: [
        { roleId: 'admin', roleName: 'Administrator', areaId: null },
        { roleId: 'platform_admin', roleName: 'Platform Administrator', areaId: null },
      ],
      areas: [],
      institutions: [],
      jti: `jti-${tenantId}`,
      sessionId: `session-${tenantId}`,
    } as never)}`,
    'x-tenant-id': tenantId,
  });

  beforeAll(async () => {
    app = await buildApp({ config: config() });
    await app.ready();
  });

  afterAll(async () => {
    await app.close();
  });

  it.each([
    ['/api/v1/custom-fields/definitions', 'custom-field'],
    ['/api/v1/dashboards/me', 'dashboards'],
  ])('does not compose %s while its domain has no durable adapter', async (url, domain) => {
    const response = await app.inject({ method: 'GET', url, headers: adminHeaders() });
    expect(response.statusCode, `${domain} must remain parked`).toBe(404);
    expect(response.json()).toMatchObject({ code: 'NOT_FOUND', message: 'Route not found' });
  });

  it('serves privacy legal-hold + erasure under /api/v1/privacy', async () => {
    const hold = await app.inject({
      method: 'POST',
      url: '/api/v1/privacy/legal-holds',
      headers: adminHeaders(),
      payload: {
        scope: 'tenant',
        reason: 'P0-01 compose smoke',
      },
    });
    expect(hold.statusCode).toBe(201);
    expect(hold.json()).toMatchObject({ scope: 'tenant', active: true });

    const listed = await app.inject({
      method: 'GET',
      url: '/api/v1/privacy/legal-holds',
      headers: adminHeaders(),
    });
    expect(listed.statusCode).toBe(200);
    expect(listed.json().data.length).toBeGreaterThan(0);

    const erasure = await app.inject({
      method: 'POST',
      url: '/api/v1/privacy/erasure-requests',
      headers: adminHeaders(),
      payload: {
        subjectType: 'student',
        subjectId: 'student-1',
        reason: 'DSAR smoke',
      },
    });
    expect(erasure.statusCode).toBe(201);
    expect(erasure.json()).toMatchObject({ status: 'requested', subjectId: 'student-1' });
  });
});
