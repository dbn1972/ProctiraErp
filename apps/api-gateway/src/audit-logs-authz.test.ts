/**
 * PRC-L280 — audit-logs gateway authz.
 *
 * L280 re-scopes READS of `/api/v1/audit-logs` to the caller's tenant and must
 * NOT widen writes. Rev-2 finding 8: a test first captures the guard each
 * mutating `/api/v1/audit-logs` route resolves to on base (the segment default
 * resolves to `platform`); each mutating route then gets an exact
 * `MUTATING_AUTHZ_EXACT_OVERRIDES` entry PINNED to that captured guard, so a
 * later change to the coarse segment map (or the read re-scope) can never widen
 * who may write audit evidence. The in-package `AUDIT_WRITE_ROLES` preHandler
 * stays, and a tenant admin still gets 403 on mutating audit routes.
 *
 * Failing-first on base: the mutating audit routes resolve via the generic
 * `segment:audit-logs` fallback (no pinned override), so the pinned-override
 * assertions below fail (exit 1). After the fix they resolve via explicit
 * `audit-logs.*` override rule ids, all still at `resource: 'platform'`.
 */

import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import type { FastifyInstance } from 'fastify';

import { buildApp } from './app.js';
import type { GatewayConfig } from './config.js';
import {
  MUTATING_AUTHZ_EXACT_OVERRIDES,
  resolveExactMutatingAuthz,
  evaluateExactMutatingAuthzGate,
} from './mutating-route-authz.js';

delete process.env['DATABASE_URL'];

const TENANT_A = '550e8400-e29b-41d4-a716-446655440000';

/** The mutating `/api/v1/audit-logs` routes registered by the audit plugin. */
const MUTATING_AUDIT_ROUTES: ReadonlyArray<{
  method: 'POST' | 'PUT' | 'DELETE';
  url: string;
}> = [
  { method: 'POST', url: '/api/v1/audit-logs' },
  { method: 'POST', url: '/api/v1/audit-logs/batch' },
  { method: 'PUT', url: '/api/v1/audit-logs/retention' },
  { method: 'POST', url: '/api/v1/audit-logs/archival/execute' },
  {
    method: 'POST',
    url: '/api/v1/audit-logs/dsar/11111111-1111-4111-8111-111111111111/export',
  },
];

function createTestJwtPayload(overrides?: Record<string, unknown>) {
  return {
    sub: 'user-l280',
    tenantId: TENANT_A,
    email: 'l280@example.com',
    displayName: 'L280 User',
    roles: [],
    areas: [],
    institutions: [],
    jti: 'test-jti-l280',
    sessionId: 'test-session-l280',
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

describe('PRC-L280 audit-logs mutating routes are pinned to an exact override', () => {
  it('every mutating /api/v1/audit-logs route resolves via a pinned audit-logs override at resource "platform"', () => {
    for (const route of MUTATING_AUDIT_ROUTES) {
      const guard = resolveExactMutatingAuthz(route.method, route.url);
      expect(guard, `inventory must cover ${route.method} ${route.url}`).toBeTruthy();
      // Writes must not be widened: audit writes stay a platform control-plane action.
      expect(guard?.resource, `${route.method} ${route.url} resource`).toBe('platform');
      // The guard must come from an explicit, pinned override — never the
      // coarse segment fallback whose resolution could drift with the map.
      expect(
        guard?.ruleId,
        `${route.method} ${route.url} must be pinned by an explicit audit-logs override, not the segment default (got ${guard?.ruleId})`,
      ).toMatch(/^audit-logs\./);
    }
  });

  it('declares an explicit audit-logs override rule for each mutating verb group', () => {
    const auditOverrides = MUTATING_AUTHZ_EXACT_OVERRIDES.filter((r) =>
      r.id.startsWith('audit-logs.'),
    );
    expect(
      auditOverrides.length,
      'at least one pinned audit-logs override must exist',
    ).toBeGreaterThan(0);
    // Every pinned override keeps writes on the platform control plane.
    for (const rule of auditOverrides) {
      expect(rule.resource).toBe('platform');
      expect(rule.pathPrefix.startsWith('/api/v1/audit-logs')).toBe(true);
    }
  });

  it('the gateway exact gate keeps audit writes on the platform resource', () => {
    for (const route of MUTATING_AUDIT_ROUTES) {
      const gate = evaluateExactMutatingAuthzGate({
        method: route.method,
        url: route.url,
        isPlatformAdmin: false,
      });
      expect(gate.ok, `${route.method} ${route.url} must resolve a guard`).toBe(true);
      if (gate.ok) {
        expect(gate.guard?.resource).toBe('platform');
      }
    }
  });
});

describe('PRC-L280 writes stay closed to tenant admins; reads stay open within the tenant', () => {
  let app: FastifyInstance;

  beforeAll(async () => {
    app = await buildApp({ config: createTestConfig() });
    await app.ready();
  });

  afterAll(async () => {
    await app.close();
  });

  for (const route of MUTATING_AUDIT_ROUTES) {
    it(`tenant admin → 403 on ${route.method} ${route.url} (write not widened)`, async () => {
      const token = app.jwt.sign(
        createTestJwtPayload({
          roles: [{ roleId: 'admin', roleName: 'Admin', areaId: 'root' }],
        }),
      );
      const response = await app.inject({
        method: route.method,
        url: route.url,
        headers: {
          authorization: `Bearer ${token}`,
          'content-type': 'application/json',
          'x-tenant-id': TENANT_A,
        },
        payload: {},
      });
      expect(response.statusCode).toBe(403);
    });
  }

  it('authenticated tenant user can READ /api/v1/audit-logs (not 403)', async () => {
    const token = app.jwt.sign(
      createTestJwtPayload({
        roles: [{ roleId: 'admin', roleName: 'Admin', areaId: 'root' }],
      }),
    );
    const response = await app.inject({
      method: 'GET',
      url: '/api/v1/audit-logs',
      headers: {
        authorization: `Bearer ${token}`,
        'x-tenant-id': TENANT_A,
      },
    });
    // Read may 200 (scoped to the caller's tenant) but must never be forbidden.
    expect(response.statusCode).not.toBe(403);
  });
});
