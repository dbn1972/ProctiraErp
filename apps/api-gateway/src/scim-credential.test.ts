/**
 * PRC-M027 / DR4-1 — SCIM authenticates with a dedicated hashed token, never
 * an interactive JWT, and the token principal is confined to the SCIM API.
 * Exercised through the real app.ts hook chain (auth → header strip →
 * tenantPlugin → suspension / tenant-session revocation → RBAC).
 */
import { MemoryTenantSessionRevocationStore } from '@proctira/backend-auth';
import type { FastifyInstance } from 'fastify';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';

import {
  OTHER_TENANT_ID,
  TEST_TENANT_ID,
  authHeaders,
  createTestConfig,
} from './__tests__/gateway-test-kit.js';
import { buildApp } from './app.js';
import { InMemoryScimTokenStore } from './scim-token-store.js';
import { noteTenantStatusChange } from './tenant-entitlement.js';

delete process.env['DATABASE_URL'];

const USER_SCHEMA = 'urn:ietf:params:scim:schemas:core:2.0:User';
const PEPPER = 'm027-test-pepper-0123456789abcdef0123456789';

describe('PRC-M027 dedicated SCIM credentials', () => {
  let app: FastifyInstance;
  const store = new InMemoryScimTokenStore(PEPPER);
  const revocation = new MemoryTenantSessionRevocationStore();
  let tokenA = '';
  let tokenB = '';

  const scim = (token: string, extra: Record<string, string> = {}) => ({
    authorization: `Bearer ${token}`,
    'content-type': 'application/scim+json',
    ...extra,
  });

  const issueViaRoute = async (tenantId: string) => {
    const res = await app.inject({
      method: 'POST',
      url: '/api/v1/tenant/scim-token',
      headers: authHeaders(app, { roles: ['admin'], tenantId, sub: `admin-${tenantId}` }),
    });
    expect(res.statusCode, res.body).toBe(201);
    expect(res.headers['cache-control']).toBe('no-store');
    return res.json() as { id: string; token: string };
  };

  beforeAll(async () => {
    app = await buildApp({
      config: createTestConfig(),
      tenantSessionRevocationStore: revocation,
      credentialPrincipals: { scimTokenStore: store, scimTokenPepper: PEPPER },
    });
    await app.ready();
    tokenA = (await issueViaRoute(TEST_TENANT_ID)).token;
    tokenB = (await issueViaRoute(OTHER_TENANT_ID)).token;
  });

  afterAll(async () => {
    await app.close();
  });

  it('only the hash is stored; the raw token is shown once', async () => {
    const issued = await issueViaRoute(TEST_TENANT_ID);
    expect(issued.token).toMatch(/^scim_[A-Za-z0-9_-]{43}$/);
    expect(
      JSON.stringify([...(store as unknown as { docs: Map<string, unknown> }).docs.values()]),
    ).not.toContain(issued.token);
    tokenA = issued.token;
  });

  it('a SCIM token works on /scim/v2 (SCIM GET /Users -> 200)', async () => {
    const res = await app.inject({
      method: 'GET',
      url: '/api/v1/scim/v2/Users',
      headers: scim(tokenA),
    });
    expect(res.statusCode, res.body).toBe(200);
  });

  it('an admin JWT on /scim/v2 is refused (401)', async () => {
    const res = await app.inject({
      method: 'GET',
      url: '/api/v1/scim/v2/Users',
      headers: authHeaders(app, { roles: ['admin'] }),
    });
    expect(res.statusCode).toBe(401);
  });

  it('a revoked or unknown token -> 401', async () => {
    const unknown = await app.inject({
      method: 'GET',
      url: '/api/v1/scim/v2/Users',
      headers: scim(`scim_${'x'.repeat(43)}`),
    });
    expect(unknown.statusCode).toBe(401);
    const temp = await issueViaRoute(OTHER_TENANT_ID);
    const del = await app.inject({
      method: 'DELETE',
      url: '/api/v1/tenant/scim-token',
      headers: authHeaders(app, { roles: ['admin'], tenantId: OTHER_TENANT_ID }),
    });
    expect(del.statusCode, del.body).toBe(200);
    expect(del.json().revoked).toBeGreaterThanOrEqual(1);
    const revoked = await app.inject({
      method: 'GET',
      url: '/api/v1/scim/v2/Users',
      headers: scim(temp.token),
    });
    expect(revoked.statusCode).toBe(401);
    tokenB = (await issueViaRoute(OTHER_TENANT_ID)).token;
  });

  it('a tenant-A token with a spoofed x-tenant-id for B acts only on A', async () => {
    const create = await app.inject({
      method: 'POST',
      url: '/api/v1/scim/v2/Users',
      headers: scim(tokenA, { 'x-tenant-id': OTHER_TENANT_ID }),
      payload: JSON.stringify({ schemas: [USER_SCHEMA], userName: 'spoof.m027@school.org' }),
    });
    expect(create.statusCode, create.body).toBe(201);
    const filter = encodeURIComponent('userName eq "spoof.m027@school.org"');
    const inA = await app.inject({
      method: 'GET',
      url: `/api/v1/scim/v2/Users?filter=${filter}`,
      headers: scim(tokenA),
    });
    expect(inA.json().totalResults).toBe(1);
    const inB = await app.inject({
      method: 'GET',
      url: `/api/v1/scim/v2/Users?filter=${filter}`,
      headers: scim(tokenB),
    });
    expect(inB.json().totalResults).toBe(0);
  });

  it('a suspended tenant’s token is refused by the suspension gate', async () => {
    noteTenantStatusChange(OTHER_TENANT_ID, 'suspended');
    try {
      const res = await app.inject({
        method: 'GET',
        url: '/api/v1/scim/v2/Users',
        headers: scim(tokenB),
      });
      expect(res.statusCode).toBe(403);
      expect(res.json().code).toBe('TENANT_SUSPENDED');
    } finally {
      noteTenantStatusChange(OTHER_TENANT_ID, 'active');
    }
  });

  it.each([
    ['GET', '/api/v1/students'],
    ['GET', '/api/v1/tenant/users'],
    ['POST', '/api/v1/tenant/scim-token'],
    ['GET', '/api/v1/billing/me/entitlements'],
    ['GET', '/api/v1/notifications'],
    ['GET', '/api/v1/meta/error-codes'],
    ['GET', '/api/v1/services'],
  ] as const)(
    'the SCIM principal is denied off its allow-list: %s %s -> 403',
    async (method, url) => {
      const res = await app.inject({ method, url, headers: scim(tokenA) });
      expect(res.statusCode, `${method} ${url}`).toBe(403);
    },
  );

  it('a non-admin cannot issue a SCIM token', async () => {
    const res = await app.inject({
      method: 'POST',
      url: '/api/v1/tenant/scim-token',
      headers: authHeaders(app, { roles: ['teacher'] }),
    });
    expect(res.statusCode).toBe(403);
  });

  it('a token issued before a tenant-wide revocation -> 401 SESSION_REVOKED; a later one works', async () => {
    const before = await store.issue(TEST_TENANT_ID, null, new Date(Date.now() - 60_000));
    await revocation.revokeTenantSessions(TEST_TENANT_ID, Math.floor(Date.now() / 1000) - 30, 3600);
    try {
      const old = await app.inject({
        method: 'GET',
        url: '/api/v1/scim/v2/Users',
        headers: scim(before.token),
      });
      expect(old.statusCode).toBe(401);
      expect(old.json().code).toBe('SESSION_REVOKED');
      const after = await store.issue(TEST_TENANT_ID, null, new Date(Date.now() + 1_000));
      const fresh = await app.inject({
        method: 'GET',
        url: '/api/v1/scim/v2/Users',
        headers: scim(after.token),
      });
      expect(fresh.statusCode, fresh.body).toBe(200);
    } finally {
      revocation.clear();
    }
  });
});

describe('PRC-M027 the SCIM surface never accepts an interactive JWT', () => {
  let app: FastifyInstance;
  beforeAll(async () => {
    app = await buildApp({ config: createTestConfig() });
    await app.ready();
  });
  afterAll(async () => {
    await app.close();
  });

  it.each([
    ['GET', '/api/v1/scim/v2/Users'],
    ['GET', '/api/v1/scim/v2/Groups'],
    ['POST', '/api/v1/scim/v2/Users'],
  ] as const)('admin JWT on %s %s -> 401', async (method, url) => {
    const res = await app.inject({
      method,
      url,
      headers: {
        ...authHeaders(app, { roles: ['admin'] }),
        'content-type': 'application/scim+json',
      },
      ...(method === 'POST'
        ? { payload: JSON.stringify({ schemas: [USER_SCHEMA], userName: 'jwt.m027@school.org' }) }
        : {}),
    });
    expect(res.statusCode).toBe(401);
  });
});
