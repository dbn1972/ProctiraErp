/**
 * UATENV-D19 — the registrar at the gateway.
 *
 * Owner-delegated decision 2026-11-26: the registrar reads the applications
 * list and processes applications, with no fees or finance access added.
 * `packages/backend/registration/src/registration-access.ts` already lists the
 * registrar; the gateway gave it only `staff:manage`, so /admissions was 403.
 *
 * | role      | gateway `registration`     | gateway `institution` (lookups) |
 * | registrar | read, list, create, update | read, list                      |
 *
 * The web route set for /admissions must not exceed the gateway read grant.
 */
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';

import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import type { FastifyInstance } from 'fastify';
import type { PermissionAction } from '@proctira/auth';

import { buildApp } from './app.js';
import type { GatewayConfig } from './config.js';
import { createGatewayRbacRegistry } from './rbac-registry.js';

delete process.env['DATABASE_URL'];

const TENANT_A = '550e8400-e29b-41d4-a716-446655440000';
const ACTIONS: PermissionAction[] = ['read', 'list', 'create', 'update', 'delete', 'manage'];

function createTestConfig(): GatewayConfig {
  return {
    port: 0,
    host: '127.0.0.1',
    env: 'test',
    rateLimiting: { windowMs: 60000, maxRequests: 10000 },
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

describe('registrar admissions grants in the gateway registry (UATENV-D19)', () => {
  const registry = createGatewayRbacRegistry();

  it('grants registration read/list/create/update and institution read/list only', () => {
    for (const action of ACTIONS) {
      expect(registry.roleHasPermission('registrar', 'registration', action), action).toBe(
        ['read', 'list', 'create', 'update'].includes(action),
      );
      expect(registry.roleHasPermission('registrar', 'institution', action), action).toBe(
        ['read', 'list'].includes(action),
      );
    }
  });

  it('adds no fees write, finance, payroll, scholarship or wildcard grant', () => {
    for (const action of ['create', 'update', 'delete', 'manage'] as const) {
      expect(registry.roleHasPermission('registrar', 'fees', action), `fees:${action}`).toBe(false);
    }
    for (const resource of ['finance', 'payroll', 'scholarship', 'platform', 'student']) {
      for (const action of ACTIONS) {
        expect(
          registry.roleHasPermission('registrar', resource, action),
          `${resource}:${action}`,
        ).toBe(false);
      }
    }
    for (const permission of registry.getRole('registrar')!.permissions) {
      expect(permission.resource).not.toBe('*');
    }
  });

  it('pins the exact registrar grant list', () => {
    const grants = registry
      .getRole('registrar')!
      .permissions.map((p) => `${p.resource}:${p.action}`)
      .sort();
    expect(grants).toEqual([
      'fees:list',
      'fees:read',
      'hostel:list',
      'hostel:read',
      'institution:list',
      'institution:read',
      'registration:create',
      'registration:list',
      'registration:read',
      'registration:update',
      'staff:manage',
      'transport:list',
      'transport:read',
    ]);
  });

  it('leaves the admissions officer and the nurse without a registration write', () => {
    for (const roleId of ['admissions_officer', 'nurse', 'hr_officer', 'staff_admin']) {
      expect(registry.roleHasPermission(roleId, 'registration', 'create'), roleId).toBe(false);
      expect(registry.roleHasPermission(roleId, 'registration', 'update'), roleId).toBe(false);
    }
  });

  it('every web /admissions route role holds the gateway registration read', () => {
    const src = readFileSync(
      resolve(__dirname, '../../web/src/lib/auth/domain-route-guards.ts'),
      'utf8',
    );
    const body = /\badmissions: new Set\(\[([^\]]*)\]\)/.exec(src)?.[1];
    expect(body, 'DOMAIN_ROUTE_ROLE_IDS.admissions').toBeDefined();
    const roles = [...body!.matchAll(/'([a-z_-]+)'/g)].map((match) => match[1]!);
    expect(roles).toContain('registrar');
    for (const roleId of roles) {
      // The web set uses the hyphenated 'super-admin' that DEFAULT_ROLES uses.
      expect(registry.roleHasPermission(roleId, 'registration', 'read'), roleId).toBe(true);
    }
  });
});

describe('registrar admissions requests through the gateway RBAC hook (UATENV-D19)', () => {
  let app: FastifyInstance;
  beforeAll(async () => {
    app = await buildApp({ config: createTestConfig() });
    await app.ready();
  });
  afterAll(async () => {
    await app.close();
  });

  function get(roleId: string, url: string) {
    const token = app.jwt.sign({
      sub: `user-${roleId}`,
      tenantId: TENANT_A,
      email: `${roleId}@example.com`,
      displayName: roleId,
      roles: [{ roleId, roleName: roleId, areaId: 'root' }],
      areas: [],
      institutions: [],
      jti: `jti-${roleId}`,
      sessionId: `sid-${roleId}`,
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
    } as any);
    return app.inject({
      method: 'GET',
      url,
      headers: { authorization: `Bearer ${token}`, 'x-tenant-id': TENANT_A },
    });
  }

  it.each(['/api/v1/admissions/enquiries', '/api/v1/institutions', '/api/v1/academic-periods'])(
    'registrar passes the gateway RBAC gate on GET %s',
    async (url) => {
      const response = await get('registrar', url);
      expect(response.statusCode, response.body).not.toBe(403);
      expect(response.statusCode).not.toBe(401);
    },
  );

  it('the nurse is still refused admissions reads', async () => {
    const response = await get('nurse', '/api/v1/admissions/enquiries');
    expect(response.statusCode).toBe(403);
  });

  it('the registrar is still refused fee writes', async () => {
    const token = app.jwt.sign({
      sub: 'user-registrar',
      tenantId: TENANT_A,
      email: 'registrar@example.com',
      displayName: 'registrar',
      roles: [{ roleId: 'registrar', roleName: 'registrar', areaId: 'root' }],
      areas: [],
      institutions: [],
      jti: 'jti-registrar-fees',
      sessionId: 'sid-registrar-fees',
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
    } as any);
    const response = await app.inject({
      method: 'POST',
      url: '/api/v1/fees/invoices',
      headers: {
        authorization: `Bearer ${token}`,
        'x-tenant-id': TENANT_A,
        'content-type': 'application/json',
      },
      payload: {},
    });
    expect(response.statusCode).toBe(403);
  });
});
