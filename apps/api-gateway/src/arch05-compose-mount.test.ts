/**
 * W1-ARCH-05 — custom-field, dashboards, and privacy are composed on the gateway.
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
    },
  };
}

describe('W1-ARCH-05 gateway compose mounts', () => {
  let app: FastifyInstance;

  const adminHeaders = (tenantId = TENANT_A) => ({
    authorization: `Bearer ${app.jwt.sign({
      sub: 'admin-1',
      tenantId,
      email: 'admin@example.com',
      displayName: 'Admin',
      roles: [{ roleId: 'admin', roleName: 'Administrator', areaId: null }],
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

  it('serves custom-field definitions under /api/v1/custom-fields', async () => {
    const created = await app.inject({
      method: 'POST',
      url: '/api/v1/custom-fields/definitions',
      headers: adminHeaders(),
      payload: {
        entityType: 'student',
        fieldKey: 'blood_group',
        label: 'Blood group',
        fieldType: 'text',
        validationRules: {},
        displayOrder: 1,
      },
    });
    expect(created.statusCode).toBe(201);
    expect(created.json()).toMatchObject({ fieldKey: 'blood_group', entityType: 'student' });

    const listed = await app.inject({
      method: 'GET',
      url: '/api/v1/custom-fields/definitions',
      headers: adminHeaders(),
    });
    expect(listed.statusCode).toBe(200);
  });

  it('serves role dashboards under /api/v1/dashboards', async () => {
    const me = await app.inject({
      method: 'GET',
      url: '/api/v1/dashboards/me',
      headers: adminHeaders(),
    });
    // Scope mismatch may 403 for admin without parent/student role; route must exist (not 404).
    expect([200, 403]).toContain(me.statusCode);

    const country = await app.inject({
      method: 'GET',
      url: '/api/v1/dashboards/country',
      headers: adminHeaders(),
    });
    expect([200, 403]).toContain(country.statusCode);
  });

  it('serves privacy legal-hold + erasure under /api/v1/privacy', async () => {
    const hold = await app.inject({
      method: 'POST',
      url: '/api/v1/privacy/legal-holds',
      headers: adminHeaders(),
      payload: {
        scope: 'tenant',
        reason: 'W1-ARCH-05 compose smoke',
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
