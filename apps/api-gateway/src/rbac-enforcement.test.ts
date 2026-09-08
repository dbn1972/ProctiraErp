/**
 * G-101 / G-104 — gateway RBAC enforcement and platform-admin role gate.
 */

import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import type { FastifyInstance } from 'fastify';

import { buildApp } from './app.js';
import type { GatewayConfig } from './config.js';
import {
  actionForMethod,
  createGatewayRbacRegistry,
  resourceForApiPath,
} from './rbac-registry.js';

delete process.env['DATABASE_URL'];

function createTestJwtPayload(overrides?: Record<string, unknown>) {
  return {
    sub: 'user-123',
    tenantId: '550e8400-e29b-41d4-a716-446655440000',
    email: 'test@example.com',
    displayName: 'Test User',
    roles: [],
    areas: [],
    institutions: [],
    jti: 'test-jti-rbac',
    sessionId: 'test-session-rbac',
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
      institutions: {
        prefix: '/institutions',
        target: 'http://localhost:3002',
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

describe('rbac-registry helpers', () => {
  it('maps path prefixes to resources', () => {
    expect(resourceForApiPath('/api/v1/students')).toBe('student');
    expect(resourceForApiPath('/api/v1/students/abc')).toBe('student');
    expect(resourceForApiPath('/api/v1/health/screenings')).toBe('health');
    expect(resourceForApiPath('/api/v1/scholarships')).toBe('scholarship');
    expect(resourceForApiPath('/api/v1/parent-portal/children')).toBe('parent');
    expect(resourceForApiPath('/api/v1/tenants')).toBe('platform');
    expect(resourceForApiPath('/api/v1/auth/login')).toBeUndefined();
    expect(resourceForApiPath('/health')).toBeUndefined();
  });

  it('maps HTTP methods to PermissionAction (no write)', () => {
    expect(actionForMethod('GET')).toBe('read');
    expect(actionForMethod('POST')).toBe('create');
    expect(actionForMethod('PUT')).toBe('update');
    expect(actionForMethod('PATCH')).toBe('update');
    expect(actionForMethod('DELETE')).toBe('delete');
  });

  it('extends admin with campus resources and registers platform_admin', () => {
    const registry = createGatewayRbacRegistry();
    expect(registry.roleHasPermission('admin', 'health', 'manage')).toBe(true);
    expect(registry.roleHasPermission('admin', 'scholarship', 'create')).toBe(true);
    expect(registry.roleHasPermission('admin', 'communication', 'create')).toBe(true);
    expect(registry.roleHasPermission('teacher', 'student', 'create')).toBe(false);
    expect(registry.roleHasPermission('nurse', 'health', 'manage')).toBe(true);
    expect(registry.roleHasPermission('parent', 'parent', 'read')).toBe(true);
    expect(registry.roleHasPermission('platform_admin', 'platform', 'manage')).toBe(true);
    expect(registry.roleHasPermission('super-admin', 'platform', 'create')).toBe(true);
  });
});

describe('G-101 gateway RBAC enforcement', () => {
  let app: FastifyInstance;

  beforeAll(async () => {
    app = await buildApp({ config: createTestConfig() });
    await app.ready();
  });

  afterAll(async () => {
    await app.close();
  });

  it('returns 403 when user lacks permission on POST /api/v1/students', async () => {
    const token = app.jwt.sign(
      createTestJwtPayload({
        roles: [
          {
            roleId: 'teacher',
            roleName: 'Teacher',
            areaId: 'root',
          },
        ],
      }),
    );

    const response = await app.inject({
      method: 'POST',
      url: '/api/v1/students',
      headers: {
        authorization: `Bearer ${token}`,
        'x-tenant-id': '550e8400-e29b-41d4-a716-446655440000',
        'content-type': 'application/json',
      },
      payload: { firstName: 'Ada', lastName: 'Lovelace' },
    });

    expect(response.statusCode).toBe(403);
    const body = response.json();
    expect(body.code).toBe('FORBIDDEN');
  });

  it('returns 403 when JWT has empty roles on mutating campus routes', async () => {
    const token = app.jwt.sign(createTestJwtPayload({ roles: [] }));

    const response = await app.inject({
      method: 'POST',
      url: '/api/v1/students',
      headers: {
        authorization: `Bearer ${token}`,
        'x-tenant-id': '550e8400-e29b-41d4-a716-446655440000',
        'content-type': 'application/json',
      },
      payload: {},
    });

    expect(response.statusCode).toBe(403);
    expect(response.json().code).toBe('FORBIDDEN');
  });

  it('allows admin to POST /api/v1/students (student:manage)', async () => {
    const token = app.jwt.sign(
      createTestJwtPayload({
        roles: [
          {
            roleId: 'admin',
            roleName: 'Administrator',
            areaId: 'root',
          },
        ],
      }),
    );

    const response = await app.inject({
      method: 'POST',
      url: '/api/v1/students',
      headers: {
        authorization: `Bearer ${token}`,
        'x-tenant-id': '550e8400-e29b-41d4-a716-446655440000',
        'content-type': 'application/json',
      },
      payload: {
        firstName: 'Ada',
        lastName: 'Lovelace',
        dateOfBirth: '2000-01-01',
      },
    });

    // Not 403 — either created or domain validation (400). Proves RBAC passed.
    expect(response.statusCode).not.toBe(403);
    expect(response.statusCode).not.toBe(401);
  });

  it('does not enforce RBAC on GET (mutating-only gate)', async () => {
    const token = app.jwt.sign(createTestJwtPayload({ roles: [] }));

    const response = await app.inject({
      method: 'GET',
      url: '/api/v1/students',
      headers: {
        authorization: `Bearer ${token}`,
        'x-tenant-id': '550e8400-e29b-41d4-a716-446655440000',
      },
    });

    expect(response.statusCode).toBe(200);
  });

  it('excludes /api/v1/auth/* from RBAC mutating checks', async () => {
    const token = app.jwt.sign(createTestJwtPayload({ roles: [] }));

    const response = await app.inject({
      method: 'POST',
      url: '/api/v1/auth/password-reset',
      headers: {
        authorization: `Bearer ${token}`,
        'x-tenant-id': '550e8400-e29b-41d4-a716-446655440000',
        'content-type': 'application/json',
      },
      payload: { email: 'x@example.com' },
    });

    // Proxied auth target is down → 502, not 403 from RBAC
    expect(response.statusCode).toBe(502);
    expect(response.json().code).toBe('BAD_GATEWAY');
  });
});

describe('G-104 platform-admin role gate', () => {
  let app: FastifyInstance;

  beforeAll(async () => {
    app = await buildApp({ config: createTestConfig() });
    await app.ready();
  });

  afterAll(async () => {
    await app.close();
  });

  it('returns 403 for non-admin on GET /api/v1/tenants', async () => {
    const token = app.jwt.sign(
      createTestJwtPayload({
        roles: [
          {
            roleId: 'admin',
            roleName: 'Administrator',
            areaId: 'root',
          },
        ],
      }),
    );

    const response = await app.inject({
      method: 'GET',
      url: '/api/v1/tenants',
      headers: {
        authorization: `Bearer ${token}`,
        'x-tenant-id': '550e8400-e29b-41d4-a716-446655440000',
      },
    });

    expect(response.statusCode).toBe(403);
    expect(response.json().code).toBe('FORBIDDEN');
    expect(response.json().message).toMatch(/platform administrator/i);
  });

  it('allows platform_admin on GET /api/v1/tenants', async () => {
    const token = app.jwt.sign(
      createTestJwtPayload({
        roles: [
          {
            roleId: 'platform_admin',
            roleName: 'Platform Administrator',
            areaId: 'root',
          },
        ],
      }),
    );

    const response = await app.inject({
      method: 'GET',
      url: '/api/v1/tenants',
      headers: {
        authorization: `Bearer ${token}`,
        'x-tenant-id': '550e8400-e29b-41d4-a716-446655440000',
      },
    });

    expect(response.statusCode).toBe(200);
    expect(response.json().items).toBeInstanceOf(Array);
  });

  it('allows super-admin (DEFAULT_ROLES) on GET /api/v1/tenants', async () => {
    const token = app.jwt.sign(
      createTestJwtPayload({
        roles: [
          {
            roleId: 'super-admin',
            roleName: 'Super Administrator',
            areaId: 'root',
          },
        ],
      }),
    );

    const response = await app.inject({
      method: 'GET',
      url: '/api/v1/tenants',
      headers: {
        authorization: `Bearer ${token}`,
        'x-tenant-id': '550e8400-e29b-41d4-a716-446655440000',
      },
    });

    expect(response.statusCode).toBe(200);
  });
});
