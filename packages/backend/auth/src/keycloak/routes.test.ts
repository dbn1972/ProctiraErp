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
  });
});
