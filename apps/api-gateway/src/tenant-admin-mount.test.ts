/**
 * G-910 — the tenant admin console (`/tenant/*`) is reachable through the
 * gateway for a tenant admin, denied for a teacher, and its mutations land in
 * the audit log with riskLevel high.
 */
import type { FastifyInstance } from 'fastify';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';

import { buildApp } from './app.js';
import type { GatewayConfig } from './config.js';

delete process.env['DATABASE_URL'];

const TENANT_A = '550e8400-e29b-41d4-a716-446655440000';
const TENANT_B = '660e8400-e29b-41d4-a716-446655440001';

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

describe('G-910 tenant admin console mount', () => {
  let app: FastifyInstance;

  const headers = (roleId: string, tenantId = TENANT_A) => ({
    authorization: `Bearer ${app.jwt.sign({
      sub: `${roleId}-1`,
      tenantId,
      email: `${roleId}@example.com`,
      displayName: roleId,
      roles: [{ roleId, roleName: roleId, areaId: null }],
      areas: [],
      institutions: [],
      jti: `jti-${roleId}-${tenantId}`,
      sessionId: `session-${roleId}-${tenantId}`,
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

  it('admin: roles seeded from DEFAULT_ROLES, invite user, settings round-trip; audited', async () => {
    const roles = await app.inject({
      method: 'GET',
      url: '/api/v1/tenant/roles',
      headers: headers('admin'),
    });
    expect(roles.statusCode, roles.body).toBe(200);
    const roleList = roles.json().data as Array<{ id: string; builtIn: boolean; name: string }>;
    expect(roleList.some((r) => r.builtIn && /teacher/i.test(r.name))).toBe(true);
    const teacherRole = roleList.find((r) => /teacher/i.test(r.name))!;

    const invited = await app.inject({
      method: 'POST',
      url: '/api/v1/tenant/users',
      headers: headers('admin'),
      payload: {
        email: 'new.teacher@school.test',
        displayName: 'New Teacher',
        roleIds: [teacherRole.id],
      },
    });
    expect(invited.statusCode, invited.body).toBe(201);

    const users = await app.inject({
      method: 'GET',
      url: '/api/v1/tenant/users',
      headers: headers('admin'),
    });
    expect(users.json().data).toHaveLength(1);

    const settings = await app.inject({
      method: 'PUT',
      url: '/api/v1/tenant/settings',
      headers: headers('admin'),
      payload: {
        displayName: 'Tenant A Board',
        defaultLocale: 'en',
        supportedLocales: ['en'],
        timezone: 'UTC',
        academicYearStartMonth: 4,
        branding: { primaryColor: '#112233', accentColor: '#445566', logoUrl: null },
        contact: { email: null, phone: null },
      },
    });
    expect(settings.statusCode, settings.body).toBe(200);

    const audit = await app.inject({
      method: 'GET',
      url: '/api/v1/audit-logs?entityType=user',
      headers: headers('super-admin'),
    });
    expect(audit.statusCode, audit.body).toBe(200);
    const entries = audit.json().data as Array<{ metadata?: { riskLevel?: string } }>;
    expect(entries.some((e) => e.metadata?.riskLevel === 'high')).toBe(true);

    // Tenant B sees none of it.
    const otherUsers = await app.inject({
      method: 'GET',
      url: '/api/v1/tenant/users',
      headers: headers('admin', TENANT_B),
    });
    expect(otherUsers.json().data).toEqual([]);
    const otherSettings = await app.inject({
      method: 'GET',
      url: '/api/v1/tenant/settings',
      headers: headers('admin', TENANT_B),
    });
    expect(otherSettings.json().displayName).not.toBe('Tenant A Board');
  });

  it('teacher is denied the console', async () => {
    const res = await app.inject({
      method: 'GET',
      url: '/api/v1/tenant/users',
      headers: headers('teacher'),
    });
    expect(res.statusCode).toBe(403);
  });
});
