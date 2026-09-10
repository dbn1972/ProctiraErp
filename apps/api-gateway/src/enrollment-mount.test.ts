/**
 * G-701 — enrollment + bulk-import routes are mounted through studentPlugin.
 */
import type { FastifyInstance } from 'fastify';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';

import { buildApp } from './app.js';
import type { GatewayConfig } from './config.js';

delete process.env['DATABASE_URL'];

const TENANT_ID = '550e8400-e29b-41d4-a716-446655440000';
const UUID_A = '11111111-1111-4111-8111-111111111111';
const UUID_B = '22222222-2222-4222-8222-222222222222';
const UUID_C = '33333333-3333-4333-8333-333333333333';
const UUID_D = '44444444-4444-4444-8444-444444444444';

function adminToken(app: FastifyInstance): string {
  return app.jwt.sign({
    sub: 'user-701',
    tenantId: TENANT_ID,
    email: 'admin@example.com',
    displayName: 'Admin',
    roles: [{ roleId: 'admin', roleName: 'Administrator', areaId: 'root' }],
    areas: [],
    institutions: [],
    jti: 'jti-701',
    sessionId: 'session-701',
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
  } as any);
}

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

describe('G-701 enrollment + import mount', () => {
  let app: FastifyInstance;

  beforeAll(async () => {
    app = await buildApp({ config: createTestConfig() });
    await app.ready();
  });

  afterAll(async () => {
    await app.close();
  });

  it('POST /api/v1/enrollments reaches the enrollment service (institution validation, not route 404)', async () => {
    const token = adminToken(app);
    const created = await app.inject({
      method: 'POST',
      url: '/api/v1/enrollments',
      headers: { authorization: `Bearer ${token}`, 'x-tenant-id': TENANT_ID },
      payload: {
        studentId: UUID_A,
        institutionId: UUID_B,
        gradeId: UUID_C,
        academicPeriodId: UUID_D,
        enrolledAt: '2026-09-01',
      },
    });
    // In-memory gateway has no institutions, so the domain service rejects the
    // institution id — proving the handler is mounted (a missing route would
    // return the gateway's generic NOT_FOUND without this message).
    expect(created.statusCode).toBe(404);
    expect(created.json().message).toMatch(/Institution with id/);

    const listed = await app.inject({
      method: 'GET',
      url: `/api/v1/enrollments?studentId=${UUID_A}`,
      headers: { authorization: `Bearer ${token}`, 'x-tenant-id': TENANT_ID },
    });
    expect(listed.statusCode).toBe(200);
    expect(Array.isArray(listed.json().data)).toBe(true);
  });

  it('POST /api/v1/students/import is mounted (400 FILE_REQUIRED without payload, not 404)', async () => {
    const token = adminToken(app);
    const res = await app.inject({
      method: 'POST',
      url: '/api/v1/students/import',
      headers: { authorization: `Bearer ${token}`, 'x-tenant-id': TENANT_ID },
      payload: {},
    });
    expect(res.statusCode).toBe(400);
    expect(res.json().code).toBe('FILE_REQUIRED');
  });

  it('enrollment writes are RBAC-gated (teacher → 403)', async () => {
    const token = app.jwt.sign({
      sub: 'teacher-1',
      tenantId: TENANT_ID,
      roles: [{ roleId: 'teacher', roleName: 'Teacher', areaId: null }],
      areas: [],
      institutions: [],
      jti: 'jti-t',
      sessionId: 's-t',
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
    } as any);
    const res = await app.inject({
      method: 'POST',
      url: '/api/v1/enrollments',
      headers: { authorization: `Bearer ${token}`, 'x-tenant-id': TENANT_ID },
      payload: {},
    });
    expect(res.statusCode).toBe(403);
  });
});
