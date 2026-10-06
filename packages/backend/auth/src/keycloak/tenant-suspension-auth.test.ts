/**
 * PRC-H008 / PRC-H098: a suspended tenant cannot sign in or refresh, and a refresh token issued
 * before a tenant-wide revocation is refused after reactivation.
 */
import Fastify from 'fastify';
import { afterEach, describe, expect, it, vi } from 'vitest';

import {
  MemoryTenantSessionRevocationStore,
  RedisTenantSessionRevocationStore,
  isIssuedBeforeTenantRevocation,
} from '../tenant-session-revocation.js';

import { registerKeycloakAuthRoutes, type KeycloakRouteConfig } from './routes.js';

const TENANT = '7a1f2c3d-4e5f-4a6b-8c7d-9e0f1a2b3c4d';
const ISSUER = 'http://localhost:8180/realms/proctira';

function jwt(payload: Record<string, unknown>): string {
  const enc = (v: unknown) => Buffer.from(JSON.stringify(v)).toString('base64url');
  return `${enc({ alg: 'RS256', typ: 'JWT' })}.${enc(payload)}.sig`;
}

const now = () => Math.floor(Date.now() / 1000);

function tokenResponse() {
  return new Response(
    JSON.stringify({
      access_token: jwt({ sub: 'kc-1', tenant_id: TENANT, iat: now(), exp: now() + 300 }),
      refresh_token: jwt({ sub: 'kc-1', iat: now(), exp: now() + 1800, typ: 'Refresh' }),
      expires_in: 300,
      token_type: 'Bearer',
    }),
    { status: 200, headers: { 'content-type': 'application/json' } },
  );
}

async function buildRoutes(extra: Partial<KeycloakRouteConfig>) {
  const app = Fastify();
  await registerKeycloakAuthRoutes(app, {
    issuer: ISSUER,
    clientId: 'proctira-gateway',
    realm: 'proctira',
    jwksUri: `${ISSUER}/protocol/openid-connect/certs`,
    redirectUri: 'http://localhost:3200/api/v1/auth/callback',
    ...extra,
  });
  return app;
}

function idpLogoutCalls(fetchMock: { mock: { calls: unknown[][] } }) {
  return fetchMock.mock.calls.filter((call) =>
    String(call[0]).endsWith('/protocol/openid-connect/logout'),
  );
}

describe('Keycloak sign-in for suspended tenants (PRC-H008)', () => {
  afterEach(() => vi.restoreAllMocks());

  it('password login for a suspended tenant is 403 and the issued IdP session is ended', async () => {
    const fetchMock = vi
      .spyOn(globalThis, 'fetch')
      .mockImplementation(() => Promise.resolve(tokenResponse()));
    const app = await buildRoutes({ tenantAuthGate: (id) => Promise.resolve(id === TENANT) });
    const res = await app.inject({
      method: 'POST',
      url: '/api/v1/auth/password',
      payload: { username: 'teacher@school.example', password: 'pw' },
    });
    expect(res.statusCode).toBe(403);
    expect(res.json().code).toBe('TENANT_SUSPENDED');
    expect(res.json().accessToken).toBeUndefined();
    expect(idpLogoutCalls(fetchMock)).toHaveLength(1);
    await app.close();
  });

  it('password login for an active tenant still succeeds', async () => {
    vi.spyOn(globalThis, 'fetch').mockImplementation(() => Promise.resolve(tokenResponse()));
    const app = await buildRoutes({ tenantAuthGate: () => Promise.resolve(false) });
    const res = await app.inject({
      method: 'POST',
      url: '/api/v1/auth/password',
      payload: { username: 'teacher@school.example', password: 'pw' },
    });
    expect(res.statusCode).toBe(200);
    expect(res.json().accessToken).toBeTruthy();
    await app.close();
  });

  it('fails closed with 503 when tenant status cannot be read', async () => {
    vi.spyOn(globalThis, 'fetch').mockImplementation(() => Promise.resolve(tokenResponse()));
    const app = await buildRoutes({ tenantAuthGate: () => Promise.reject(new Error('db down')) });
    const res = await app.inject({
      method: 'POST',
      url: '/api/v1/auth/password',
      payload: { username: 'teacher@school.example', password: 'pw' },
    });
    expect(res.statusCode).toBe(503);
    expect(res.json().code).toBe('TENANT_STATUS_UNAVAILABLE');
    await app.close();
  });

  it('OIDC callback for a suspended tenant is 403', async () => {
    vi.spyOn(globalThis, 'fetch').mockImplementation(() => Promise.resolve(tokenResponse()));
    const app = await buildRoutes({ tenantAuthGate: () => Promise.resolve(true) });
    // PRC-M500: the callback must present the browser-bound state cookie issued by /login.
    const login = await app.inject({ method: 'GET', url: '/api/v1/auth/login' });
    const cookie = String(login.headers['set-cookie']).split(';')[0]!;
    const state = new URL(String(login.headers.location)).searchParams.get('state')!;
    const res = await app.inject({
      method: 'GET',
      url: `/api/v1/auth/callback?code=abc&state=${encodeURIComponent(state)}`,
      headers: { cookie },
    });
    expect(res.statusCode).toBe(403);
    expect(res.json().code).toBe('TENANT_SUSPENDED');
    await app.close();
  });

  it('refresh for a suspended tenant is 403', async () => {
    vi.spyOn(globalThis, 'fetch').mockImplementation(() => Promise.resolve(tokenResponse()));
    const app = await buildRoutes({ tenantAuthGate: () => Promise.resolve(true) });
    const res = await app.inject({
      method: 'POST',
      url: '/api/v1/auth/refresh',
      payload: { refreshToken: jwt({ iat: now() - 60 }) },
    });
    expect(res.statusCode).toBe(403);
    expect(res.json().code).toBe('TENANT_SUSPENDED');
    await app.close();
  });

  it('after reactivation, a refresh token issued before the revocation is 401; a newer one works', async () => {
    const fetchMock = vi
      .spyOn(globalThis, 'fetch')
      .mockImplementation(() => Promise.resolve(tokenResponse()));
    const revocations = new MemoryTenantSessionRevocationStore();
    await revocations.revokeTenantSessions(TENANT, now() - 10, 3600);
    const app = await buildRoutes({
      tenantAuthGate: () => Promise.resolve(false),
      tenantSessionRevocation: revocations,
    });
    const stale = await app.inject({
      method: 'POST',
      url: '/api/v1/auth/refresh',
      payload: { refreshToken: jwt({ iat: now() - 3600 }) },
    });
    expect(stale.statusCode).toBe(401);
    expect(stale.json().code).toBe('SESSION_REVOKED');
    expect(idpLogoutCalls(fetchMock)).toHaveLength(1);

    const fresh = await app.inject({
      method: 'POST',
      url: '/api/v1/auth/refresh',
      payload: { refreshToken: jwt({ iat: now() }) },
    });
    expect(fresh.statusCode).toBe(200);
    expect(fresh.json().accessToken).toBeTruthy();
    await app.close();
  });
});

describe('tenant session revocation stores', () => {
  it('rejects tokens issued at/before the epoch and tokens without iat', () => {
    expect(isIssuedBeforeTenantRevocation(100, null)).toBe(false);
    expect(isIssuedBeforeTenantRevocation(100, 100)).toBe(true);
    expect(isIssuedBeforeTenantRevocation(101, 100)).toBe(false);
    expect(isIssuedBeforeTenantRevocation(undefined, 100)).toBe(true);
  });

  it('memory store never moves the epoch backwards and expires', async () => {
    const store = new MemoryTenantSessionRevocationStore();
    await store.revokeTenantSessions('t', 200, 60);
    await store.revokeTenantSessions('t', 150, 60);
    expect(await store.tenantSessionsRevokedAt('t')).toBe(200);
    expect(await store.tenantSessionsRevokedAt('other')).toBeNull();
  });

  it('redis store writes SET EX with the max epoch and reads it back', async () => {
    const data = new Map<string, string>();
    const redis = {
      set: vi.fn((key: string, value: string) => {
        data.set(key, value);
        return Promise.resolve('OK');
      }),
      get: vi.fn((key: string) => Promise.resolve(data.get(key) ?? null)),
    };
    const store = new RedisTenantSessionRevocationStore(redis);
    await store.revokeTenantSessions('t', 300, 3600);
    await store.revokeTenantSessions('t', 250, 3600);
    expect(redis.set).toHaveBeenLastCalledWith('auth:tenant-revoke:t', '300', 'EX', 3600);
    expect(await store.tenantSessionsRevokedAt('t')).toBe(300);
    expect(await store.tenantSessionsRevokedAt('none')).toBeNull();
  });
});
