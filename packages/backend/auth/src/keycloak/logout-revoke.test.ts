/**
 * W1-SEC-09 — Keycloak /logout must denylist access jti/sid (and refresh JWT
 * identifiers when presented) before redirecting to IdP end-session.
 * Shared-store multi-replica deny is proven with two keycloakAuthPlugin verifiers.
 */
import { generateKeyPairSync, sign } from 'node:crypto';

import Fastify from 'fastify';
import { afterEach, describe, expect, it, vi } from 'vitest';

import { MemoryAccessTokenRevocationStore } from '../access-token-revocation.js';

import { keycloakAuthPlugin } from './plugin.js';
import { registerKeycloakAuthRoutes } from './routes.js';

function toBase64Url(value: Buffer | string): string {
  return Buffer.from(value).toString('base64url');
}

function signRs256(payload: Record<string, unknown>, privateKeyPem: string, kid = 'test-kid'): string {
  const header = toBase64Url(JSON.stringify({ alg: 'RS256', typ: 'JWT', kid }));
  const body = toBase64Url(JSON.stringify(payload));
  const signed = `${header}.${body}`;
  const signature = sign('RSA-SHA256', Buffer.from(signed), privateKeyPem).toString('base64url');
  return `${signed}.${signature}`;
}

const issuer = 'http://localhost:8180/realms/proctira';
const routeConfigBase = {
  issuer,
  clientId: 'proctira-gateway',
  realm: 'proctira',
  jwksUri: 'http://localhost:8180/realms/proctira/protocol/openid-connect/certs',
  redirectUri: 'http://localhost:3200/api/v1/auth/callback',
  webOrigin: 'http://localhost:3201',
} as const;

describe('Keycloak /logout revocation (W1-SEC-09)', () => {
  const apps: Array<ReturnType<typeof Fastify>> = [];

  afterEach(async () => {
    await Promise.all(apps.splice(0).map((app) => app.close()));
    vi.restoreAllMocks();
  });

  it('denylists access jti/sid before redirecting to IdP end-session', async () => {
    const store = new MemoryAccessTokenRevocationStore();
    const now = Math.floor(Date.now() / 1000);
    const accessToken = [
      toBase64Url(JSON.stringify({ alg: 'none', typ: 'JWT' })),
      toBase64Url(
        JSON.stringify({
          sub: 'kc-user',
          jti: 'jti-kc-logout',
          sid: 'sid-kc-logout',
          exp: now + 600,
        }),
      ),
      'sig',
    ].join('.');

    const app = Fastify();
    apps.push(app);
    await registerKeycloakAuthRoutes(app, { ...routeConfigBase, revocationStore: store });

    const response = await app.inject({
      method: 'GET',
      url: '/api/v1/auth/logout?redirect=http://localhost:3201/login',
      headers: { authorization: `Bearer ${accessToken}` },
    });

    expect(response.statusCode).toBe(302);
    expect(response.headers.location).toContain('/protocol/openid-connect/logout');
    expect(response.headers.location).toContain('post_logout_redirect_uri=');
    expect(await store.isRevoked('jti', 'jti-kc-logout')).toBe(true);
    expect(await store.isRevoked('sid', 'sid-kc-logout')).toBe(true);
  });

  it('denylists refresh JWT jti/sid when presented alongside access', async () => {
    const store = new MemoryAccessTokenRevocationStore();
    const now = Math.floor(Date.now() / 1000);
    const accessToken = [
      toBase64Url(JSON.stringify({ alg: 'none', typ: 'JWT' })),
      toBase64Url(
        JSON.stringify({
          sub: 'kc-user',
          jti: 'jti-access',
          sid: 'sid-shared',
          exp: now + 300,
        }),
      ),
      'sig',
    ].join('.');
    const refreshToken = [
      toBase64Url(JSON.stringify({ alg: 'none', typ: 'JWT' })),
      toBase64Url(
        JSON.stringify({
          sub: 'kc-user',
          jti: 'jti-refresh',
          sid: 'sid-shared',
          exp: now + 3600,
          typ: 'Refresh',
        }),
      ),
      'sig',
    ].join('.');

    const app = Fastify();
    apps.push(app);
    await registerKeycloakAuthRoutes(app, { ...routeConfigBase, revocationStore: store });

    const response = await app.inject({
      method: 'GET',
      url: `/api/v1/auth/logout?refresh_token=${encodeURIComponent(refreshToken)}`,
      headers: { authorization: `Bearer ${accessToken}` },
    });

    expect(response.statusCode).toBe(302);
    expect(await store.isRevoked('jti', 'jti-access')).toBe(true);
    expect(await store.isRevoked('jti', 'jti-refresh')).toBe(true);
    expect(await store.isRevoked('sid', 'sid-shared')).toBe(true);
  });

  it('still redirects to IdP when no bearer is presented (revoke is a no-op)', async () => {
    const store = new MemoryAccessTokenRevocationStore();
    const app = Fastify();
    apps.push(app);
    await registerKeycloakAuthRoutes(app, { ...routeConfigBase, revocationStore: store });

    const response = await app.inject({
      method: 'GET',
      url: '/api/v1/auth/logout',
    });

    expect(response.statusCode).toBe(302);
    expect(response.headers.location).toContain('/protocol/openid-connect/logout');
  });

  it('logout on replica A denies the bearer on replica B via shared denylist', async () => {
    const { publicKey, privateKey } = generateKeyPairSync('rsa', { modulusLength: 2048 });
    const jwk = publicKey.export({ format: 'jwk' });
    const privateKeyPem = privateKey.export({ type: 'pkcs1', format: 'pem' }).toString();
    const now = Math.floor(Date.now() / 1000);

    const fetchMock = vi.spyOn(globalThis, 'fetch').mockImplementation(async (input) => {
      const url = String(input);
      if (url.includes('/protocol/openid-connect/certs')) {
        return new Response(JSON.stringify({ keys: [{ ...jwk, kid: 'test-kid', kty: 'RSA' }] }), {
          status: 200,
          headers: { 'content-type': 'application/json' },
        });
      }
      return new Response('not found', { status: 404 });
    });

    const shared = new MemoryAccessTokenRevocationStore();
    const token = signRs256(
      {
        sub: 'kc-shared',
        iss: issuer,
        exp: now + 900,
        iat: now,
        azp: 'proctira-gateway',
        email: 'shared@proctira.in',
        tenant_id: 'tenant-1',
        jti: 'jti-kc-shared-logout',
        sid: 'sid-kc-shared-logout',
        realm_access: { roles: ['admin'] },
      },
      privateKeyPem,
    );

    const replicaA = Fastify();
    const replicaB = Fastify();
    apps.push(replicaA, replicaB);

    await replicaA.register(keycloakAuthPlugin, {
      config: routeConfigBase,
      revocationStore: shared,
      excludePaths: ['/api/v1/auth/logout'],
    });
    await registerKeycloakAuthRoutes(replicaA, {
      ...routeConfigBase,
      revocationStore: shared,
    });

    await replicaB.register(keycloakAuthPlugin, {
      config: routeConfigBase,
      revocationStore: shared,
    });
    replicaB.get('/protected', { preHandler: [replicaB.authenticate] }, async () => ({ ok: true }));

    await replicaA.ready();
    await replicaB.ready();

    const before = await replicaB.inject({
      method: 'GET',
      url: '/protected',
      headers: { authorization: `Bearer ${token}` },
    });
    expect(before.statusCode).toBe(200);

    const logout = await replicaA.inject({
      method: 'GET',
      url: '/api/v1/auth/logout',
      headers: { authorization: `Bearer ${token}` },
    });
    expect(logout.statusCode).toBe(302);
    expect(logout.headers.location).toContain('/protocol/openid-connect/logout');

    const after = await replicaB.inject({
      method: 'GET',
      url: '/protected',
      headers: { authorization: `Bearer ${token}` },
    });
    expect(after.statusCode).toBe(401);
    expect(after.json()).toMatchObject({
      code: 'TOKEN_REVOKED',
      reason: 'revoked_jti',
    });

    fetchMock.mockRestore();
  });
});
