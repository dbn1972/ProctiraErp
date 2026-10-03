/**
 * PRC-M466 — role/user mutations are audited with the real JWT actor, and a
 * failing audit sink surfaces as 5xx instead of a silent, unaudited success.
 */
import type { FastifyInstance } from 'fastify';
import { afterAll, beforeAll, describe, expect, it, vi } from 'vitest';

import { buildApp } from './app.js';
import type { GatewayConfig } from './config.js';

delete process.env['DATABASE_URL'];

const TENANT = '550e8400-e29b-41d4-a716-446655440000';

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

describe('PRC-M466 tenant admin audit actor + fail-closed sink', () => {
  let app: FastifyInstance;
  const headers = () => ({
    authorization: `Bearer ${app.jwt.sign({
      sub: 'admin-m466',
      tenantId: TENANT,
      email: 'admin@example.com',
      displayName: 'Admin',
      roles: [{ roleId: 'admin', roleName: 'admin', areaId: null }],
      areas: [],
      institutions: [],
      jti: 'jti-m466',
      sessionId: 'session-m466',
    } as never)}`,
    'x-tenant-id': TENANT,
  });

  beforeAll(async () => {
    app = await buildApp({ config: config() });
    await app.ready();
  });

  afterAll(async () => {
    await app.close();
  });

  type Audit = { recordAudit: (input: Record<string, unknown>) => Promise<unknown> };
  const audit = (): Audit => (app as unknown as { auditService: Audit }).auditService;

  it('records the JWT sub as the audit actor for a user invite', async () => {
    const spy = vi.spyOn(audit(), 'recordAudit');
    const res = await app.inject({
      method: 'POST',
      url: '/api/v1/tenant/users',
      headers: headers(),
      payload: { email: 'a.m466@school.test', displayName: 'A', roleIds: [] },
    });
    expect(res.statusCode, res.body).toBe(201);
    const userEvents = spy.mock.calls
      .map(([input]) => input)
      .filter((input) => input['entityType'] === 'user');
    expect(userEvents.length).toBeGreaterThan(0);
    expect(userEvents.every((e) => e['userId'] === 'admin-m466')).toBe(true);
    spy.mockRestore();
  });

  it('fails the request with 5xx when the audit sink rejects', async () => {
    const original = audit().recordAudit.bind(audit());
    const spy = vi
      .spyOn(audit(), 'recordAudit')
      .mockImplementation(async (input: Record<string, unknown>) => {
        if (input['entityType'] === 'user') throw new Error('audit db down');
        return original(input);
      });
    const res = await app.inject({
      method: 'POST',
      url: '/api/v1/tenant/users',
      headers: headers(),
      payload: { email: 'b.m466@school.test', displayName: 'B', roleIds: [] },
    });
    // Gateway error handler maps the 503 TenantAdminAuditError to a generic 5xx body.
    expect(res.statusCode, res.body).toBeGreaterThanOrEqual(500);
    spy.mockRestore();
  });
});
