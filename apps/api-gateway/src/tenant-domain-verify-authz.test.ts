/**
 * PRC-L169 — the custom-domain verify route carries exactly the add-domain guard.
 *
 * `POST /api/v1/tenant-lifecycle/:id/domains/:domainId/verify` is mounted beside
 * `POST /api/v1/tenant-lifecycle/:id/domains` (tenantLifecyclePlugin). The `tenant-lifecycle`
 * segment maps to the `platform` resource, so the segment default applies and
 * `mutating-route-authz.ts` is not edited: tenant admins and teachers get 403 at the gateway;
 * only a platform admin reaches the handler.
 */
import type { FastifyInstance } from 'fastify';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';

import { buildApp } from './app.js';
import type { GatewayConfig } from './config.js';
import { actionForMethod, resourceForApiPath } from './rbac-registry.js';

delete process.env['DATABASE_URL'];

const JWT_TENANT = '550e8400-e29b-41d4-a716-446655440000';

function payload(roles: Array<{ roleId: string; roleName: string }>) {
  return {
    sub: `user-${roles[0]?.roleId ?? 'none'}`,
    tenantId: JWT_TENANT,
    email: 'test@example.com',
    displayName: 'Test User',
    roles: roles.map((r) => ({ ...r, areaId: null })),
    areas: [],
    institutions: [],
    jti: `jti-${roles[0]?.roleId ?? 'none'}`,
    sessionId: `session-${roles[0]?.roleId ?? 'none'}`,
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
  } as any;
}

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
  } as GatewayConfig;
}

describe('PRC-L169: verify-domain gateway guard', () => {
  let app: FastifyInstance;
  let tenantId: string;
  let domainId: string;

  beforeAll(async () => {
    app = await buildApp({
      config: config(),
      tenantAdminProvisioner: { provisionTenantAdmin: async () => ({ adminUserId: 'admin-1' }) },
    });
    await app.ready();
    const tenant = await app.tenantService.createTenant({
      name: 'Verify Authz',
      slug: 'verify-authz',
      admin: { email: 'admin@example.com', firstName: 'A', lastName: 'B' },
    } as Parameters<typeof app.tenantService.createTenant>[0]);
    tenantId = tenant.id;
    domainId = (await app.tenantService.addDomain(tenantId, { domain: 'verify-authz.invalid' })).id;
  });

  afterAll(async () => {
    await app.close();
  });

  const verifyUrl = () => `/api/v1/tenant-lifecycle/${tenantId}/domains/${domainId}/verify`;

  it('resolves to the same resource and action as add-domain', () => {
    const add = `/api/v1/tenant-lifecycle/${'x'}/domains`;
    const verify = `/api/v1/tenant-lifecycle/${'x'}/domains/${'y'}/verify`;
    expect(resourceForApiPath(verify)).toBe(resourceForApiPath(add));
    expect(resourceForApiPath(verify)).toBe('platform');
    expect(actionForMethod('POST')).toBe(actionForMethod('POST'));
  });

  it.each([
    ['tenant admin', { roleId: 'admin', roleName: 'Administrator' }],
    ['teacher', { roleId: 'teacher', roleName: 'Teacher' }],
  ])('a %s gets 403 at the gateway (add-domain and verify alike)', async (_label, role) => {
    const token = app.jwt.sign(payload([role]));
    const verify = await app.inject({
      method: 'POST',
      url: verifyUrl(),
      headers: { authorization: `Bearer ${token}` },
    });
    expect(verify.statusCode).toBe(403);
    const add = await app.inject({
      method: 'POST',
      url: `/api/v1/tenant-lifecycle/${tenantId}/domains`,
      headers: { authorization: `Bearer ${token}` },
      payload: { domain: 'another.invalid' },
    });
    expect(add.statusCode).toBe(403);
  });

  it('no token -> 401', async () => {
    const res = await app.inject({ method: 'POST', url: verifyUrl() });
    expect(res.statusCode).toBe(401);
  });

  it('a platform admin reaches the handler: unproven ownership -> 422, domain stays unverified', async () => {
    const token = app.jwt.sign(
      payload([{ roleId: 'platform_admin', roleName: 'Platform Administrator' }]),
    );
    const res = await app.inject({
      method: 'POST',
      url: verifyUrl(),
      headers: { authorization: `Bearer ${token}` },
    });
    expect(res.statusCode).toBe(422);
    const [domain] = await app.tenantService.listDomains(tenantId);
    expect(domain?.verified).toBe(false);
  });
});
