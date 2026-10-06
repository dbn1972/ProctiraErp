/**
 * PRC-H048 — marketplace review/publish and developer-docs mutations are
 * platform control-plane actions. A tenant admin (CAMPUS_MANAGE `developer:*`)
 * must be denied at the gateway; platform_admin / super-admin clear the gate.
 */
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import type { FastifyInstance } from 'fastify';
import { buildApp } from './app.js';
import type { GatewayConfig } from './config.js';
import {
  evaluateExactMutatingAuthzGate,
  resolveExactMutatingAuthz,
} from './mutating-route-authz.js';

delete process.env['DATABASE_URL'];

const TENANT_ID = '550e8400-e29b-41d4-a716-446655440000';
const SUBMISSION_ID = '11111111-1111-4111-8111-111111111111';

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

const PLATFORM_ROUTES: ReadonlyArray<{ method: 'POST' | 'PATCH' | 'DELETE'; url: string }> = [
  { method: 'POST', url: `/api/v1/developer/submissions/${SUBMISSION_ID}/review` },
  { method: 'POST', url: `/api/v1/developer/submissions/${SUBMISSION_ID}/publish` },
  { method: 'POST', url: '/api/v1/developer/docs' },
  { method: 'PATCH', url: '/api/v1/developer/docs/getting-started' },
  { method: 'DELETE', url: '/api/v1/developer/docs/getting-started' },
];

describe('PRC-H048 developer-portal platform-staff inventory', () => {
  it('maps review, publish and docs mutations to the platform resource', () => {
    for (const route of PLATFORM_ROUTES) {
      const guard = resolveExactMutatingAuthz(route.method, route.url);
      expect(guard?.resource, `${route.method} ${route.url}`).toBe('platform');
    }
  });

  it('keeps tenant-owned developer routes on the developer resource', () => {
    for (const url of [
      '/api/v1/developer/accounts',
      `/api/v1/developer/accounts/${SUBMISSION_ID}/submissions`,
      '/api/v1/developer/analytics/events',
      '/api/v1/developer/marketplace/alpha/ratings',
    ]) {
      expect(resolveExactMutatingAuthz('POST', url)?.resource, url).toBe('developer');
    }
  });

  it('gate resolves platform guard for tenant callers (resource check denies later)', () => {
    const gate = evaluateExactMutatingAuthzGate({
      method: 'POST',
      url: `/api/v1/developer/submissions/${SUBMISSION_ID}/review`,
      isPlatformAdmin: false,
    });
    expect(gate.ok && gate.guard).toMatchObject({
      resource: 'platform',
      ruleId: 'developer.marketplace.review',
    });
  });
});

describe('PRC-H048 developer-portal platform-staff enforcement (gateway)', () => {
  let app: FastifyInstance;

  beforeAll(async () => {
    app = await buildApp({ config: createTestConfig() });
    await app.ready();
  });

  afterAll(async () => {
    await app.close();
  });

  function tokenFor(roleId: string, roleName = roleId): string {
    return app.jwt.sign({
      sub: `user-${roleId}`,
      tenantId: TENANT_ID,
      email: `${roleId}@example.com`,
      displayName: roleId,
      roles: [{ roleId, roleName, areaId: 'root' }],
      areas: [],
      institutions: [],
      jti: `jti-${roleId}`,
      sessionId: `session-${roleId}`,
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
    } as any);
  }

  async function call(route: (typeof PLATFORM_ROUTES)[number], token: string) {
    return app.inject({
      method: route.method,
      url: route.url,
      headers: {
        authorization: `Bearer ${token}`,
        'content-type': 'application/json',
        'x-tenant-id': TENANT_ID,
      },
      payload: route.method === 'DELETE' ? undefined : { decision: 'approved' },
    });
  }

  for (const route of PLATFORM_ROUTES) {
    it(`tenant admin → 403 on ${route.method} ${route.url}`, async () => {
      const res = await call(route, tokenFor('admin'));
      expect(res.statusCode).toBe(403);
      expect(res.json().code).toBe('FORBIDDEN');
    });

    it(`roleName spoof (platform_admin label on admin roleId) → 403 on ${route.method} ${route.url}`, async () => {
      const res = await call(route, tokenFor('admin', 'platform_admin'));
      expect(res.statusCode).toBe(403);
    });

    it(`platform_admin clears the gateway gate on ${route.method} ${route.url}`, async () => {
      const res = await call(route, tokenFor('platform_admin'));
      // Domain validation / not-found may 4xx; the gateway must not 403.
      expect(res.statusCode).not.toBe(403);
    });
  }
});
