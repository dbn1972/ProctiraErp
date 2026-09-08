/**
 * G-105: audit plugin is mounted; mutating /api/v1 calls produce audit rows.
 */

import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import type { FastifyInstance } from 'fastify';

import { buildApp } from './app.js';
import type { GatewayConfig } from './config.js';

delete process.env['DATABASE_URL'];

const TENANT_ID = '550e8400-e29b-41d4-a716-446655440000';

function createTestJwtPayload(overrides?: Record<string, unknown>) {
  return {
    sub: 'user-123',
    tenantId: TENANT_ID,
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
    jti: 'test-jti-audit',
    sessionId: 'test-session-audit',
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

describe('G-105 audit mount', () => {
  let app: FastifyInstance;

  beforeAll(async () => {
    app = await buildApp({ config: createTestConfig() });
    await app.ready();
  });

  afterAll(async () => {
    await app.close();
  });

  it('decorates auditService on the gateway', () => {
    expect(app.auditService).toBeDefined();
    expect(typeof app.auditService.recordAudit).toBe('function');
    expect(typeof app.auditService.queryAuditLogs).toBe('function');
  });

  it('mounts billingService and tenantService (G-106 packages)', () => {
    expect(app.billingService).toBeDefined();
    expect(app.tenantService).toBeDefined();
  });

  it('records an audit row on a successful mutating API call', async () => {
    const before = await app.auditService.queryAuditLogs({
      tenantId: TENANT_ID,
      page: 1,
      pageSize: 100,
    });
    const beforeCount = before.data.length;

    const token = app.jwt.sign(createTestJwtPayload());

    const response = await app.inject({
      method: 'POST',
      url: '/api/v1/students',
      headers: {
        authorization: `Bearer ${token}`,
        'x-tenant-id': TENANT_ID,
        'content-type': 'application/json',
      },
      payload: {
        firstName: 'Ada',
        lastName: 'Lovelace',
        dateOfBirth: '2000-01-01',
      },
    });

    expect(response.statusCode).not.toBe(401);
    expect(response.statusCode).not.toBe(403);
    // Domain validation may return 400; RBAC/auth must have passed.
    expect(response.statusCode).toBeLessThan(500);

    const after = await app.auditService.queryAuditLogs({
      tenantId: TENANT_ID,
      page: 1,
      pageSize: 100,
    });

    expect(after.data.length).toBeGreaterThan(beforeCount);
    const latest = after.data[0]!;
    expect(latest.operation).toBe('CREATE');
    expect(latest.userId).toBe('user-123');
    expect(latest.entityType).toBe('student');
  });
});
