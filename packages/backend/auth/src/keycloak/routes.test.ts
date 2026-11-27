import Fastify from 'fastify';
import { describe, expect, it, vi } from 'vitest';

import { MemoryWebTicketStore, registerKeycloakAuthRoutes, webReturnTo } from './routes.js';

/** PRC-M500: start a login and return the cookie + state the callback must present. */
async function beginLogin(app: ReturnType<typeof Fastify>, appState?: string) {
  const res = await app.inject({
    method: 'GET',
    url: `/api/v1/auth/login${appState ? `?state=${encodeURIComponent(appState)}` : ''}`,
  });
  const cookie = String(res.headers['set-cookie']).split(';')[0]!;
  const location = new URL(String(res.headers.location));
  const state = location.searchParams.get('state')!;
  const txn = JSON.parse(Buffer.from(cookie.split('=')[1]!, 'base64url').toString()) as {
    n: string;
    v: string;
  };
  return { cookie, state, location, txn };
}

describe('Keycloak auth routes', () => {
  it('redirects login to the Keycloak authorization endpoint', async () => {
    const app = Fastify();
    await registerKeycloakAuthRoutes(app, {
      issuer: 'http://localhost:8180/realms/proctira',
      clientId: 'proctira-gateway',
      realm: 'proctira',
      jwksUri: 'http://localhost:8180/realms/proctira/protocol/openid-connect/certs',
      redirectUri: 'http://localhost:3200/api/v1/auth/callback',
    });

    const response = await app.inject({
      method: 'GET',
      url: '/api/v1/auth/login?state=abc',
    });

    expect(response.statusCode).toBe(302);
    expect(response.headers.location).toContain('/protocol/openid-connect/auth');
    expect(response.headers.location).toContain('client_id=proctira-gateway');
    // PRC-M500: caller state is not echoed; a server state + PKCE + nonce are sent.
    const location = new URL(String(response.headers.location));
    expect(location.searchParams.get('state')).not.toBe('abc');
    expect(location.searchParams.get('code_challenge_method')).toBe('S256');
    expect(location.searchParams.get('code_challenge')).toBeTruthy();
    expect(location.searchParams.get('nonce')).toBeTruthy();
    expect(String(response.headers['set-cookie'])).toMatch(/kc_oidc_txn=.+HttpOnly; SameSite=Lax/);
    await app.close();
  });

  it('lists Keycloak-managed school roles', async () => {
    const app = Fastify();
    await registerKeycloakAuthRoutes(app, {
      issuer: 'http://localhost:8180/realms/proctira',
      clientId: 'proctira-gateway',
      realm: 'proctira',
      jwksUri: 'http://localhost:8180/realms/proctira/protocol/openid-connect/certs',
      redirectUri: 'http://localhost:3200/api/v1/auth/callback',
    });

    const response = await app.inject({ method: 'GET', url: '/api/v1/auth/roles' });
    expect(response.statusCode).toBe(200);
    const body = response.json() as { provider: string; roles: Array<{ roleId: string }> };
    expect(body.provider).toBe('keycloak');
    expect(body.roles.map((role) => role.roleId)).toContain('admin');
    await app.close();
  });

  it('projects the Keycloak user onto the local identity store after callback', async () => {
    const header = Buffer.from(JSON.stringify({ alg: 'RS256', typ: 'JWT' })).toString('base64url');
    const payload = Buffer.from(
      JSON.stringify({
        sub: 'kc-admin',
        email: 'admin@proctira.in',
        email_verified: true,
        name: 'India Admin',
        tenant_slug: 'india',
      }),
    ).toString('base64url');
    const accessToken = `${header}.${payload}.sig`;

    const identityStore = {
      findIdentity: vi.fn().mockResolvedValue(null),
      touchIdentity: vi.fn(),
      findUserByEmail: vi.fn().mockResolvedValue({
        id: 'user-admin',
        tenantId: 'tenant-india',
        email: 'admin@proctira.in',
        displayName: 'India Admin',
        countryCode: 'IN',
      }),
      findTenantById: vi.fn(),
      findTenantBySlug: vi.fn().mockResolvedValue({ id: 'tenant-india' }),
      createUser: vi.fn(),
      createIdentity: vi.fn().mockResolvedValue(undefined),
    };

    const fetchMock = vi.spyOn(globalThis, 'fetch').mockResolvedValue(
      new Response(
        JSON.stringify({
          access_token: accessToken,
          token_type: 'Bearer',
          expires_in: 300,
        }),
        { status: 200, headers: { 'content-type': 'application/json' } },
      ),
    );

    const app = Fastify();
    await registerKeycloakAuthRoutes(app, {
      issuer: 'http://localhost:8180/realms/proctira',
      clientId: 'proctira-gateway',
      realm: 'proctira',
      jwksUri: 'http://localhost:8180/realms/proctira/protocol/openid-connect/certs',
      redirectUri: 'http://localhost:3200/api/v1/auth/callback',
      identityStore,
    });

    const { cookie, state } = await beginLogin(app);
    const response = await app.inject({
      method: 'GET',
      url: `/api/v1/auth/callback?code=abc&state=${state}`,
      headers: { cookie },
    });

    expect(response.statusCode).toBe(200);
    expect(response.json().user).toEqual({
      userId: 'user-admin',
      tenantId: 'tenant-india',
      email: 'admin@proctira.in',
      displayName: 'India Admin',
      countryCode: 'IN',
    });
    expect(identityStore.createIdentity).toHaveBeenCalled();
    fetchMock.mockRestore();
    await app.close();
  });

  it('accepts password login without leaving the Proctira UI', async () => {
    const header = Buffer.from(JSON.stringify({ alg: 'RS256', typ: 'JWT' })).toString('base64url');
    const payload = Buffer.from(
      JSON.stringify({
        sub: 'kc-admin',
        email: 'admin@proctira.in',
        tenant_slug: 'india',
      }),
    ).toString('base64url');
    const accessToken = `${header}.${payload}.sig`;
    const fetchMock = vi.spyOn(globalThis, 'fetch').mockResolvedValue(
      new Response(
        JSON.stringify({
          access_token: accessToken,
          refresh_token: 'refresh-1',
          token_type: 'Bearer',
          expires_in: 300,
        }),
        { status: 200, headers: { 'content-type': 'application/json' } },
      ),
    );

    const app = Fastify();
    await registerKeycloakAuthRoutes(app, {
      issuer: 'http://localhost:8180/realms/proctira',
      clientId: 'proctira-gateway',
      realm: 'proctira',
      jwksUri: 'http://localhost:8180/realms/proctira/protocol/openid-connect/certs',
      redirectUri: 'http://localhost:3200/api/v1/auth/callback',
      clientSecret: 'proctira-gateway-dev-secret',
    });

    const response = await app.inject({
      method: 'POST',
      url: '/api/v1/auth/password',
      payload: { username: 'admin@proctira.in', password: 'proctira-india-admin' },
    });

    expect(response.statusCode).toBe(200);
    expect(response.json().accessToken).toBe(accessToken);
    expect(fetchMock).toHaveBeenCalled();
    const body = String(fetchMock.mock.calls[0]?.[1]?.body ?? '');
    expect(body).toContain('grant_type=password');
    fetchMock.mockRestore();
    await app.close();
  });

  it('redirects browser logins to the web callback with a one-time ticket', async () => {
    const header = Buffer.from(JSON.stringify({ alg: 'RS256', typ: 'JWT' })).toString('base64url');
    const payload = Buffer.from(JSON.stringify({ sub: 'kc-admin' })).toString('base64url');
    const accessToken = `${header}.${payload}.sig`;
    const fetchMock = vi.spyOn(globalThis, 'fetch').mockResolvedValue(
      new Response(
        JSON.stringify({
          access_token: accessToken,
          refresh_token: 'refresh-1',
          token_type: 'Bearer',
          expires_in: 300,
        }),
        { status: 200, headers: { 'content-type': 'application/json' } },
      ),
    );

    const app = Fastify();
    await registerKeycloakAuthRoutes(app, {
      issuer: 'http://localhost:8180/realms/proctira',
      clientId: 'proctira-gateway',
      realm: 'proctira',
      jwksUri: 'http://localhost:8180/realms/proctira/protocol/openid-connect/certs',
      redirectUri: 'http://localhost:3200/api/v1/auth/callback',
      webOrigin: 'http://localhost:3201',
    });

    const { cookie, state } = await beginLogin(app, 'web:/students');
    const callback = await app.inject({
      method: 'GET',
      url: `/api/v1/auth/callback?code=abc&state=${state}`,
      headers: { cookie },
    });
    // PRC-M500: PKCE verifier is sent on the code exchange.
    const tokenCall = fetchMock.mock.calls.find((c) => String(c[0]).endsWith('/token'));
    expect(String((tokenCall![1] as RequestInit).body)).toContain('code_verifier=');
    expect(callback.statusCode).toBe(302);
    const location = new URL(String(callback.headers.location));
    expect(location.origin).toBe('http://localhost:3201');
    expect(location.pathname).toBe('/api/auth/callback');
    expect(location.searchParams.get('returnTo')).toBe('/students');
    const ticket = location.searchParams.get('ticket');
    expect(ticket).toBeTruthy();

    const redeemed = await app.inject({
      method: 'GET',
      url: `/api/v1/auth/ticket?ticket=${ticket}`,
    });
    expect(redeemed.statusCode).toBe(200);
    expect(redeemed.json().accessToken).toBe(accessToken);

    const reused = await app.inject({
      method: 'GET',
      url: `/api/v1/auth/ticket?ticket=${ticket}`,
    });
    expect(reused.statusCode).toBe(401);

    fetchMock.mockRestore();
    await app.close();
  });

  describe('PRC-M500 state/PKCE/nonce binding, returnTo, shared tickets', () => {
    const base = {
      issuer: 'http://localhost:8180/realms/proctira',
      clientId: 'proctira-gateway',
      realm: 'proctira',
      jwksUri: 'http://localhost:8180/realms/proctira/protocol/openid-connect/certs',
      redirectUri: 'http://localhost:3200/api/v1/auth/callback',
      webOrigin: 'http://localhost:3201',
    };
    const jwt = (payload: Record<string, unknown>) =>
      [
        Buffer.from(JSON.stringify({ alg: 'RS256' })).toString('base64url'),
        Buffer.from(JSON.stringify(payload)).toString('base64url'),
        'sig',
      ].join('.');
    function mockToken(extra: Record<string, unknown> = {}) {
      return vi.spyOn(globalThis, 'fetch').mockImplementation(
        async () =>
          new Response(
            JSON.stringify({
              access_token: jwt({ sub: 'kc-1' }),
              token_type: 'Bearer',
              ...extra,
            }),
            { status: 200, headers: { 'content-type': 'application/json' } },
          ),
      );
    }

    it('rejects a callback with unknown state or no cookie (login CSRF / code injection)', async () => {
      const fetchMock = mockToken();
      const app = Fastify();
      await registerKeycloakAuthRoutes(app, base);
      const noCookie = await app.inject({
        method: 'GET',
        url: '/api/v1/auth/callback?code=attacker&state=x',
      });
      expect(noCookie.statusCode).toBe(400);
      expect(noCookie.json().code).toBe('KEYCLOAK_STATE_MISMATCH');
      const { cookie } = await beginLogin(app);
      const wrong = await app.inject({
        method: 'GET',
        url: '/api/v1/auth/callback?code=attacker&state=forged',
        headers: { cookie },
      });
      expect(wrong.statusCode).toBe(400);
      expect(fetchMock).not.toHaveBeenCalled();
      fetchMock.mockRestore();
      await app.close();
    });

    it('rejects an ID token whose nonce does not match the browser transaction', async () => {
      const fetchMock = mockToken({ id_token: jwt({ nonce: 'other' }) });
      const app = Fastify();
      await registerKeycloakAuthRoutes(app, base);
      const { cookie, state } = await beginLogin(app);
      const res = await app.inject({
        method: 'GET',
        url: `/api/v1/auth/callback?code=c&state=${state}`,
        headers: { cookie },
      });
      expect(res.statusCode).toBe(401);
      expect(res.json().code).toBe('KEYCLOAK_NONCE_MISMATCH');
      fetchMock.mockRestore();
      await app.close();
    });

    it('accepts a matching nonce', async () => {
      const app = Fastify();
      await registerKeycloakAuthRoutes(app, base);
      const { cookie, state, txn } = await beginLogin(app);
      const fetchMock = mockToken({ id_token: jwt({ nonce: txn.n }) });
      const res = await app.inject({
        method: 'GET',
        url: `/api/v1/auth/callback?code=c&state=${state}`,
        headers: { cookie },
      });
      expect(res.statusCode).toBe(200);
      fetchMock.mockRestore();
      await app.close();
    });

    it('rejects unsafe returnTo values', () => {
      expect(webReturnTo('web://evil.com')).toBeNull();
      expect(webReturnTo('web:/\\evil.com')).toBeNull();
      expect(webReturnTo('web:https://evil.com')).toBeNull();
      expect(webReturnTo('web:/students?x=1')).toBe('/students?x=1');
    });

    it('returnTo=//evil.com does not produce a web redirect', async () => {
      const fetchMock = mockToken();
      const app = Fastify();
      await registerKeycloakAuthRoutes(app, base);
      const { cookie, state } = await beginLogin(app, 'web://evil.com');
      const res = await app.inject({
        method: 'GET',
        url: `/api/v1/auth/callback?code=c&state=${state}`,
        headers: { cookie },
      });
      expect(res.statusCode).toBe(200);
      expect(res.headers.location).toBeUndefined();
      fetchMock.mockRestore();
      await app.close();
    });

    it('a ticket issued on replica A is redeemable once on replica B (shared store)', async () => {
      const shared = new MemoryWebTicketStore();
      const a = Fastify();
      const b = Fastify();
      await registerKeycloakAuthRoutes(a, { ...base, webTicketStore: shared });
      await registerKeycloakAuthRoutes(b, { ...base, webTicketStore: shared });
      const fetchMock = mockToken();
      const { cookie, state } = await beginLogin(a, 'web:/home');
      const cb = await a.inject({
        method: 'GET',
        url: `/api/v1/auth/callback?code=c&state=${state}`,
        headers: { cookie },
      });
      const ticket = new URL(String(cb.headers.location)).searchParams.get('ticket');
      const r1 = await b.inject({ method: 'GET', url: `/api/v1/auth/ticket?ticket=${ticket}` });
      expect(r1.statusCode).toBe(200);
      const r2 = await a.inject({ method: 'GET', url: `/api/v1/auth/ticket?ticket=${ticket}` });
      expect(r2.statusCode).toBe(401);
      fetchMock.mockRestore();
      await Promise.all([a.close(), b.close()]);
    });

    it('issues tickets as 43-char base64url and still redeems them once', async () => {
      const app = Fastify();
      await registerKeycloakAuthRoutes(app, base);
      const fetchMock = mockToken();
      const { cookie, state } = await beginLogin(app, 'web:/home');
      const cb = await app.inject({
        method: 'GET',
        url: `/api/v1/auth/callback?code=c&state=${state}`,
        headers: { cookie },
      });
      const ticket = new URL(String(cb.headers.location)).searchParams.get('ticket') ?? '';
      expect(ticket).toMatch(/^[A-Za-z0-9_-]{43}$/);
      const ok = await app.inject({ method: 'GET', url: `/api/v1/auth/ticket?ticket=${ticket}` });
      expect(ok.statusCode).toBe(200);
      expect(ok.json().accessToken).toBe(jwt({ sub: 'kc-1' }));
      fetchMock.mockRestore();
      await app.close();
    });

    it('rejects malformed ticket shapes exactly like an unknown ticket, without a store lookup', async () => {
      const store = new MemoryWebTicketStore();
      const app = Fastify();
      await registerKeycloakAuthRoutes(app, { ...base, webTicketStore: store });
      // Seed entries under the malformed ids so a pass-through lookup would succeed.
      const malformed = [
        'mfa-pending:3f1c2d4e-5a6b-4c7d-8e9f-0a1b2c3d4e5f',
        '3f1c2d4e-5a6b-4c7d-8e9f-0a1b2c3d4e5f',
        'a'.repeat(42),
        'a'.repeat(44),
        `${'a'.repeat(42)}=`,
        `${'a'.repeat(42)}.`,
        `${'a'.repeat(42)}+`,
        `${'a'.repeat(42)}/`,
      ];
      for (const id of malformed) {
        await store.put(id, JSON.stringify({ accessToken: 'leak', tokenType: 'Bearer' }), 60);
      }
      const unknown = await app.inject({
        method: 'GET',
        url: `/api/v1/auth/ticket?ticket=${'b'.repeat(43)}`,
      });
      expect(unknown.statusCode).toBe(401);
      const take = vi.spyOn(store, 'take');
      for (const id of [...malformed, 'x'.repeat(129)]) {
        const res = await app.inject({
          method: 'GET',
          url: `/api/v1/auth/ticket?ticket=${encodeURIComponent(id)}`,
        });
        expect(res.statusCode).toBe(401);
        expect(res.body).toBe(unknown.body);
      }
      const dup = await app.inject({
        method: 'GET',
        url: `/api/v1/auth/ticket?ticket=${'a'.repeat(43)}&ticket=${'b'.repeat(43)}`,
      });
      expect(dup.statusCode).toBe(401);
      expect(dup.body).toBe(unknown.body);
      expect(take).not.toHaveBeenCalled();
      await app.close();
    });
  });

  describe('UATENV-D09 tenant web origin', () => {
    const SUNRISE = 'http://sunrise-public-school.proctira.localhost:29080';
    const TENANT_B_ORIGIN = 'http://e2e-tenant-a.proctira.localhost:29080';
    const jwt = (payload: Record<string, unknown>) =>
      [
        Buffer.from(JSON.stringify({ alg: 'RS256' })).toString('base64url'),
        Buffer.from(JSON.stringify(payload)).toString('base64url'),
        'sig',
      ].join('.');
    function mockToken(claims: Record<string, unknown> = { sub: 'kc-b', tenant_id: 'tenant-b' }) {
      return vi.spyOn(globalThis, 'fetch').mockImplementation(
        async () =>
          new Response(JSON.stringify({ access_token: jwt(claims), token_type: 'Bearer' }), {
            status: 200,
            headers: { 'content-type': 'application/json' },
          }),
      );
    }
    function directory(
      impl: (id: string) => Promise<{
        id: string;
        name: string;
        slug: string;
        status: string;
      } | null>,
    ) {
      return { findTenantById: vi.fn(impl) };
    }
    const tenantB = directory(async (id) =>
      id === 'tenant-b' ? { id, name: 'B', slug: 'e2e-tenant-a', status: 'active' } : null,
    );
    const base = {
      issuer: 'http://localhost:8180/realms/proctira',
      clientId: 'proctira-gateway',
      realm: 'proctira',
      jwksUri: 'http://localhost:8180/realms/proctira/protocol/openid-connect/certs',
      redirectUri: 'http://localhost:3200/api/v1/auth/callback',
      webOrigin: SUNRISE,
      tenantWebBaseDomain: 'proctira.localhost',
    };

    async function callbackLocation(
      config: Record<string, unknown>,
      headers: Record<string, string> = {},
      appState = 'web:/students',
    ) {
      const app = Fastify();
      await registerKeycloakAuthRoutes(app, { ...base, ...config } as Parameters<
        typeof registerKeycloakAuthRoutes
      >[1]);
      const { cookie, state } = await beginLogin(app, appState);
      const res = await app.inject({
        method: 'GET',
        url: `/api/v1/auth/callback?code=c&state=${state}`,
        headers: { cookie, ...headers },
      });
      await app.close();
      expect(res.statusCode).toBe(302);
      return new URL(String(res.headers.location));
    }

    it("returns the browser to the user's own tenant host from the tenant record", async () => {
      const fetchMock = mockToken();
      const location = await callbackLocation({ tenantDirectory: tenantB });
      expect(location.origin).toBe(TENANT_B_ORIGIN);
      expect(location.pathname).toBe('/api/auth/callback');
      expect(location.searchParams.get('returnTo')).toBe('/students');
      expect(location.searchParams.get('ticket')).toBeTruthy();
      expect(tenantB.findTenantById).toHaveBeenCalledWith('tenant-b');
      fetchMock.mockRestore();
    });

    it('ignores a forged Host or X-Forwarded-Host on the callback', async () => {
      const fetchMock = mockToken();
      const location = await callbackLocation(
        { tenantDirectory: tenantB },
        { host: 'attacker.example', 'x-forwarded-host': 'attacker.example' },
      );
      expect(location.origin).toBe(TENANT_B_ORIGIN);
      fetchMock.mockRestore();
    });

    it('falls back to the configured web origin when the tenant is unknown', async () => {
      const fetchMock = mockToken();
      const location = await callbackLocation({ tenantDirectory: directory(async () => null) });
      expect(location.origin).toBe(SUNRISE);
      fetchMock.mockRestore();
    });

    it('falls back to the configured web origin when the directory throws', async () => {
      const fetchMock = mockToken();
      const location = await callbackLocation({
        tenantDirectory: directory(async () => {
          throw new Error('db down');
        }),
      });
      expect(location.origin).toBe(SUNRISE);
      fetchMock.mockRestore();
    });

    it.each(['evil.com', 'a/b', 'A_B', '', 'x.evil.com:1', '-a', 'a-'])(
      'falls back for a slug that is not one DNS label (%j)',
      async (slug) => {
        const fetchMock = mockToken();
        const location = await callbackLocation({
          tenantDirectory: directory(async (id) => ({ id, name: 'B', slug, status: 'active' })),
        });
        expect(location.origin).toBe(SUNRISE);
        fetchMock.mockRestore();
      },
    );

    it('leaves a shared web origin unchanged and does not read the directory', async () => {
      const fetchMock = mockToken();
      const shared = directory(async (id) => ({
        id,
        name: 'B',
        slug: 'e2e-tenant-a',
        status: 'active',
      }));
      const location = await callbackLocation({
        webOrigin: 'http://localhost:3201',
        tenantDirectory: shared,
      });
      expect(location.origin).toBe('http://localhost:3201');
      expect(shared.findTenantById).not.toHaveBeenCalled();
      fetchMock.mockRestore();
    });

    it('falls back when the token carries no tenant and no identity is linked', async () => {
      const fetchMock = mockToken({ sub: 'kc-b' });
      const none = directory(async () => null);
      const location = await callbackLocation({ tenantDirectory: none });
      expect(location.origin).toBe(SUNRISE);
      expect(none.findTenantById).not.toHaveBeenCalled();
      fetchMock.mockRestore();
    });

    it('keeps the configured origin when no tenant base domain is configured', async () => {
      const fetchMock = mockToken();
      const location = await callbackLocation({
        tenantDirectory: tenantB,
        tenantWebBaseDomain: undefined,
      });
      expect(location.origin).toBe(SUNRISE);
      fetchMock.mockRestore();
    });
  });
});
