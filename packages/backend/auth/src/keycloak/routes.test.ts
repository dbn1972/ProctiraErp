import Fastify from 'fastify';
import { describe, expect, it, vi } from 'vitest';

import { registerKeycloakAuthRoutes } from './routes.js';

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
    expect(response.headers.location).toContain('state=abc');
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

    const response = await app.inject({
      method: 'GET',
      url: '/api/v1/auth/callback?code=abc',
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

    const callback = await app.inject({
      method: 'GET',
      url: '/api/v1/auth/callback?code=abc&state=web:/students',
    });
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
});
