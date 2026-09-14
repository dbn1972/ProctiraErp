/**
 * W1-SEC-02 COMPLETE — inventory coverage + insufficient-permission denial.
 */

import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import type { FastifyInstance } from 'fastify';

import { buildApp } from './app.js';
import type { GatewayConfig } from './config.js';
import {
  findUninventoriedMutatingRoutes,
  INVENTORY_DENY_SAMPLES,
  listDeferredMutatingAuthzRules,
  MUTATING_ROUTE_AUTHZ_INVENTORY,
  resolveExactMutatingAuthz,
  evaluateExactMutatingAuthzGate,
} from './mutating-route-authz.js';

delete process.env['DATABASE_URL'];

function createTestJwtPayload(overrides?: Record<string, unknown>) {
  return {
    sub: 'user-sec02',
    tenantId: '550e8400-e29b-41d4-a716-446655440000',
    email: 'sec02@example.com',
    displayName: 'SEC02 User',
    roles: [],
    areas: [],
    institutions: [],
    jti: 'test-jti-sec02',
    sessionId: 'test-session-sec02',
    ...overrides,
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
  } as any;
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

describe('W1-SEC-02 mutating-route authz inventory', () => {
  it('declares exact resource/action for known campus mutations', () => {
    const exam = resolveExactMutatingAuthz(
      'POST',
      '/api/v1/examinations/11111111-1111-4111-8111-111111111111/documents/generate',
    );
    expect(exam).toMatchObject({
      resource: 'examination',
      action: 'create',
      domainAction: 'document.generate',
      deferredDomainGuard: false,
    });

    const transport = resolveExactMutatingAuthz('POST', '/api/v1/transport/vehicles');
    expect(transport).toMatchObject({
      resource: 'transport',
      action: 'create',
      deferredDomainGuard: false,
    });
  });

  it('fails closed when mutating path has no inventory rule', () => {
    const gate = evaluateExactMutatingAuthzGate({
      method: 'POST',
      url: '/api/v1/__no_such_domain__/mutate',
      isPlatformAdmin: false,
    });
    expect(gate.ok).toBe(false);
    if (!gate.ok) {
      expect(gate.reason).toBe('missing_inventory_guard');
    }
  });

  it('lists deferred domain-guard residuals honestly', () => {
    const deferred = listDeferredMutatingAuthzRules();
    expect(deferred.some((r) => r.pathPrefix.includes('/transport'))).toBe(false);
    expect(deferred.some((r) => r.pathPrefix.includes('/library'))).toBe(true);
    expect(deferred.some((r) => r.pathPrefix.includes('/registrations'))).toBe(true);
    expect(MUTATING_ROUTE_AUTHZ_INVENTORY.length).toBeGreaterThan(20);
  });
});

describe('W1-SEC-02 inventory coverage against registered routes', () => {
  let app: FastifyInstance;

  beforeAll(async () => {
    app = await buildApp({ config: createTestConfig() });
    await app.ready();
  });

  afterAll(async () => {
    await app.close();
  });

  it('every registered mutating /api/v1 route is covered by the inventory', () => {
    const registered = app.mutatingRouteAuthzRegistry?.getRegistered() ?? [];
    expect(registered.length).toBeGreaterThan(50);
    const missing = findUninventoriedMutatingRoutes(registered);
    expect(
      missing,
      `Add inventory rules for: ${missing
        .slice(0, 20)
        .map((r) => `${r.method} ${r.path}`)
        .join('; ')}`,
    ).toEqual([]);
  });
});

describe('W1-SEC-02 inventory-backed insufficient-permission denial', () => {
  let app: FastifyInstance;

  beforeAll(async () => {
    app = await buildApp({ config: createTestConfig() });
    await app.ready();
  });

  afterAll(async () => {
    await app.close();
  });

  for (const sample of INVENTORY_DENY_SAMPLES) {
    it(`${sample.id}: ${sample.deniedRole} → 403 on ${sample.method} ${sample.url}`, async () => {
      const guard = resolveExactMutatingAuthz(sample.method, sample.url);
      expect(guard, `inventory must cover ${sample.id}`).toBeTruthy();

      const token = app.jwt.sign(
        createTestJwtPayload({
          roles: [
            {
              roleId: sample.deniedRole,
              roleName: sample.deniedRole,
              areaId: 'root',
            },
          ],
        }),
      );

      const response = await app.inject({
        method: sample.method,
        url: sample.url,
        headers: {
          authorization: `Bearer ${token}`,
          'content-type': 'application/json',
          'x-tenant-id': '550e8400-e29b-41d4-a716-446655440000',
        },
        payload: sample.payload ?? {},
      });

      expect(response.statusCode).toBe(403);
      expect(response.json().code).toBe('FORBIDDEN');
    });

    it(`${sample.id}: ${sample.allowedRole} clears gateway exact guard (not 403)`, async () => {
      const token = app.jwt.sign(
        createTestJwtPayload({
          roles: [
            {
              roleId: sample.allowedRole,
              roleName: sample.allowedRole,
              areaId: 'root',
            },
          ],
        }),
      );

      const response = await app.inject({
        method: sample.method,
        url: sample.url,
        headers: {
          authorization: `Bearer ${token}`,
          'content-type': 'application/json',
          'x-tenant-id': '550e8400-e29b-41d4-a716-446655440000',
        },
        payload: sample.payload ?? {},
      });

      // Domain validation / not-found may still 4xx; gateway exact authz must not 403.
      expect(response.statusCode).not.toBe(403);
    });
  }

  it('uninventoried mutating path → 403 even for admin', async () => {
    const token = app.jwt.sign(
      createTestJwtPayload({
        roles: [{ roleId: 'admin', roleName: 'Admin', areaId: 'root' }],
      }),
    );

    const response = await app.inject({
      method: 'POST',
      url: '/api/v1/__sec02_unmapped__/write',
      headers: {
        authorization: `Bearer ${token}`,
        'content-type': 'application/json',
      },
      payload: {},
    });

    expect(response.statusCode).toBe(403);
    expect(response.json().message).toMatch(/inventory-declared/i);
  });
});
