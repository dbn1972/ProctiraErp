/**
 * PRC-M017 — invite routes are mounted under /api/v1 (RBAC, suspended-tenant
 * gate, mutation audit apply); root paths are 308 redirects only.
 * Runs in Keycloak mode (the only mode that registers invite routes) with a
 * stubbed JWKS and locally signed RS256 tokens.
 */
import { generateKeyPairSync, sign } from 'node:crypto';

import type { FastifyInstance } from 'fastify';
import { afterAll, beforeAll, describe, expect, it, vi } from 'vitest';

import { createTestConfig } from './__tests__/gateway-test-kit.js';
import { buildApp } from './app.js';
import { clearSuspendedTenantsForTests, suspendTenantForTests } from './tenant-entitlement.js';

delete process.env['DATABASE_URL'];

// The in-memory identity store only links tokens for tenants it knows about.
vi.mock('@proctira/backend-auth', async (importOriginal) => {
  const actual = await importOriginal<typeof import('@proctira/backend-auth')>();
  return {
    ...actual,
    createKeycloakIdentityStore: () => {
      const store = new actual.InMemoryKeycloakIdentityStore();
      store.seedTenant({ id: '770e8400-e29b-41d4-a716-446655440077', slug: 'm017' });
      return store;
    },
  };
});

const ISSUER = 'https://keycloak.test/realms/proctira';
const TENANT = '770e8400-e29b-41d4-a716-446655440077';
const { publicKey, privateKey } = generateKeyPairSync('rsa', { modulusLength: 2048 });
const jwk = { ...publicKey.export({ format: 'jwk' }), kid: 'm017', kty: 'RSA' };

function token(sub: string, roles: string[]): string {
  const now = Math.floor(Date.now() / 1000);
  const enc = (v: unknown) => Buffer.from(JSON.stringify(v)).toString('base64url');
  const signed = `${enc({ alg: 'RS256', typ: 'JWT', kid: 'm017' })}.${enc({
    sub,
    iss: ISSUER,
    azp: 'proctira-gateway',
    exp: now + 600,
    iat: now,
    email: `${sub}@school.test`,
    email_verified: true,
    tenant_id: TENANT,
    realm_access: { roles },
    jti: `jti-${sub}`,
    sid: `sid-${sub}`,
  })}`;
  return `${signed}.${sign('RSA-SHA256', Buffer.from(signed), privateKey).toString('base64url')}`;
}

describe('invite routes under /api/v1 (PRC-M017)', () => {
  let app: FastifyInstance;
  const saved = { ...process.env };
  beforeAll(async () => {
    process.env['KEYCLOAK_ISSUER'] = ISSUER;
    process.env['KEYCLOAK_CLIENT_ID'] = 'proctira-gateway';
    process.env['KEYCLOAK_CLIENT_SECRET'] = 'test-secret';
    const realFetch = globalThis.fetch;
    vi.stubGlobal('fetch', async (input: unknown, init?: unknown) => {
      if (String(input).includes('/protocol/openid-connect/certs')) {
        return new Response(JSON.stringify({ keys: [jwk] }));
      }
      return realFetch(input as never, init as never);
    });
    app = await buildApp({ config: createTestConfig() });
    await app.ready();
  });
  afterAll(async () => {
    await app.close();
    vi.unstubAllGlobals();
    clearSuspendedTenantsForTests();
    process.env = saved;
  });

  const headers = (sub = 'admin-1', roles = ['admin']) => ({
    authorization: `Bearer ${token(sub, roles)}`,
    'content-type': 'application/json',
  });
  const body = { email: 'new.teacher@school.test', displayName: 'New Teacher' };

  it('registers the prefixed route and keeps root only as a 308 redirect', async () => {
    expect(app.hasRoute({ method: 'POST', url: '/api/v1/tenant/users/invite' })).toBe(true);
    const legacy = await app.inject({
      method: 'POST',
      url: '/tenant/users/invite',
      headers: headers(),
      payload: body,
    });
    expect(legacy.statusCode).toBe(308);
    expect(legacy.headers['location']).toBe('/api/v1/tenant/users/invite');
  });

  it('suspended tenant POST /api/v1/tenant/users/invite → 403', async () => {
    suspendTenantForTests(TENANT);
    try {
      const res = await app.inject({
        method: 'POST',
        url: '/api/v1/tenant/users/invite',
        headers: headers(),
        payload: body,
      });
      expect(res.statusCode, res.body).toBe(403);
      expect(res.json().code).toBe('TENANT_SUSPENDED');
    } finally {
      clearSuspendedTenantsForTests();
    }
  });

  it('non-admin is denied by gateway RBAC on the prefixed route', async () => {
    const res = await app.inject({
      method: 'POST',
      url: '/api/v1/tenant/users/invite',
      headers: headers('teacher-1', ['teacher']),
      payload: body,
    });
    expect(res.statusCode).toBe(403);
  });

  it('admin invite succeeds and writes an audit row with the actor id', async () => {
    const res = await app.inject({
      method: 'POST',
      url: '/api/v1/tenant/users/invite',
      headers: headers(),
      payload: { ...body, email: 'audited.invite@school.test' },
    });
    expect([200, 201], res.body).toContain(res.statusCode);
    const logs = await app.auditService.queryAuditLogs({ tenantId: TENANT, page: 1, pageSize: 50 });
    const row = logs.data.find((r) => String(r.metadata?.['path'] ?? '').includes('/users/invite'));
    expect(row, JSON.stringify(logs.data.map((r) => r.metadata))).toBeDefined();
    expect(row!.userId).toBeTruthy();
  });
});
