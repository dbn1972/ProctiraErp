/**
 * G-106 — suspended tenants get 403 on mutating /api/v1 routes.
 */

import { afterAll, afterEach, beforeAll, describe, expect, it } from 'vitest';
import type { FastifyInstance } from 'fastify';

import { buildApp } from './app.js';
import type { GatewayConfig } from './config.js';
import {
  clearSuspendedTenantsForTests,
  isTenantSuspended,
  suspendTenantForTests,
} from './tenant-entitlement.js';

delete process.env['DATABASE_URL'];

const SUSPENDED_TENANT = '550e8400-e29b-41d4-a716-446655440099';
const ACTIVE_TENANT = '550e8400-e29b-41d4-a716-446655440000';

function createTestJwtPayload(overrides?: Record<string, unknown>) {
  return {
    sub: 'user-123',
    tenantId: ACTIVE_TENANT,
    email: 'test@example.com',
    displayName: 'Test User',
    roles: [
      {
        roleId: 'admin',
        roleName: 'Administrator',
        areaId: 'root',
      },
    ],
    areas: [],
    institutions: [],
    jti: 'test-jti-entitlement',
    sessionId: 'test-session-entitlement',
    ...overrides,
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
  } as any;
}

function createTestConfig(): GatewayConfig {
  return {
    port: 0,
    host: '127.0.0.1',
    env: 'test',
    rateLimiting: {
      windowMs: 60000,
      maxRequests: 1000,
    },
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
    tenant: {
      baseDomain: 'proctira.org',
      headerName: 'x-tenant-id',
    },
    services: {
      auth: {
        prefix: '/auth',
        target: 'http://127.0.0.1:1',
        healthCheck: '/health',
      },
      students: {
        prefix: '/students',
        target: 'http://localhost:3003',
        healthCheck: '/health',
      },
    },
  };
}

describe('tenant-entitlement helpers', () => {
  afterEach(() => {
    clearSuspendedTenantsForTests();
  });

  it('tracks suspended tenants in memory', () => {
    expect(isTenantSuspended(SUSPENDED_TENANT)).toBe(false);
    suspendTenantForTests(SUSPENDED_TENANT);
    expect(isTenantSuspended(SUSPENDED_TENANT)).toBe(true);
    clearSuspendedTenantsForTests();
    expect(isTenantSuspended(SUSPENDED_TENANT)).toBe(false);
  });
});

describe('G-106 suspended-tenant entitlement gate', () => {
  let app: FastifyInstance;

  beforeAll(async () => {
    app = await buildApp({ config: createTestConfig() });
    await app.ready();
  });

  afterAll(async () => {
    clearSuspendedTenantsForTests();
    await app.close();
  });

  afterEach(() => {
    clearSuspendedTenantsForTests();
  });

  it('returns 403 TENANT_SUSPENDED on POST when tenant is suspended', async () => {
    suspendTenantForTests(SUSPENDED_TENANT);

    const token = app.jwt.sign(
      createTestJwtPayload({
        tenantId: SUSPENDED_TENANT,
      }),
    );

    const response = await app.inject({
      method: 'POST',
      url: '/api/v1/students',
      headers: {
        authorization: `Bearer ${token}`,
        'x-tenant-id': SUSPENDED_TENANT,
        'content-type': 'application/json',
      },
      payload: { firstName: 'Ada', lastName: 'Lovelace' },
    });

    expect(response.statusCode).toBe(403);
    expect(response.json().code).toBe('TENANT_SUSPENDED');
  });

  it('returns 403 TENANT_SUSPENDED on PUT/PATCH/DELETE when suspended', async () => {
    suspendTenantForTests(SUSPENDED_TENANT);
    const token = app.jwt.sign(
      createTestJwtPayload({
        tenantId: SUSPENDED_TENANT,
      }),
    );

    for (const method of ['PUT', 'PATCH', 'DELETE'] as const) {
      const response = await app.inject({
        method,
        url: '/api/v1/students/stu-1',
        headers: {
          authorization: `Bearer ${token}`,
          'x-tenant-id': SUSPENDED_TENANT,
          'content-type': 'application/json',
        },
        payload: method === 'DELETE' ? undefined : { firstName: 'Ada' },
      });

      expect(response.statusCode).toBe(403);
      expect(response.json().code).toBe('TENANT_SUSPENDED');
    }
  });

  it('allows GET for suspended tenants (mutating-only gate)', async () => {
    suspendTenantForTests(SUSPENDED_TENANT);
    const token = app.jwt.sign(
      createTestJwtPayload({
        tenantId: SUSPENDED_TENANT,
      }),
    );

    const response = await app.inject({
      method: 'GET',
      url: '/api/v1/students',
      headers: {
        authorization: `Bearer ${token}`,
        'x-tenant-id': SUSPENDED_TENANT,
      },
    });

    expect(response.statusCode).not.toBe(403);
    expect(response.json()?.code).not.toBe('TENANT_SUSPENDED');
  });

  it('does not block mutating /api/v1/auth routes', async () => {
    suspendTenantForTests(SUSPENDED_TENANT);

    const response = await app.inject({
      method: 'POST',
      url: '/api/v1/auth/login',
      headers: {
        'x-tenant-id': SUSPENDED_TENANT,
        'content-type': 'application/json',
      },
      payload: { email: 'a@b.c', password: 'x' },
    });

    expect(response.json()?.code).not.toBe('TENANT_SUSPENDED');
  });

  it('allows mutating requests for active (non-suspended) tenants past the gate', async () => {
    const token = app.jwt.sign(createTestJwtPayload({ tenantId: ACTIVE_TENANT }));

    const response = await app.inject({
      method: 'POST',
      url: '/api/v1/students',
      headers: {
        authorization: `Bearer ${token}`,
        'x-tenant-id': ACTIVE_TENANT,
        'content-type': 'application/json',
      },
      payload: {
        firstName: 'Ada',
        lastName: 'Lovelace',
        dateOfBirth: '2000-01-01',
      },
    });

    expect(response.json()?.code).not.toBe('TENANT_SUSPENDED');
    expect(response.statusCode).not.toBe(401);
  });

  it('returns 403 when JWT tenantStatus claim is suspended', async () => {
    const token = app.jwt.sign(
      createTestJwtPayload({
        tenantId: ACTIVE_TENANT,
        tenantStatus: 'suspended',
      }),
    );

    const response = await app.inject({
      method: 'POST',
      url: '/api/v1/students',
      headers: {
        authorization: `Bearer ${token}`,
        'x-tenant-id': ACTIVE_TENANT,
        'content-type': 'application/json',
      },
      payload: { firstName: 'Blocked' },
    });

    expect(response.statusCode).toBe(403);
    expect(response.json().code).toBe('TENANT_SUSPENDED');
  });
});
