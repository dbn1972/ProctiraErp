/**
 * PRC-L283: (1) login routes fail closed when the local identity cannot be linked — no tokens
 * are handed out; (2) the linked identity is cached per verified session id so steady-state
 * requests skip the identity store.
 */
import Fastify from 'fastify';
import { afterEach, describe, expect, it, vi } from 'vitest';

import {
  createSessionIdentityCache,
  linkKeycloakIdentityForSession,
  resetIdentityTouchThrottleForTests,
  type KeycloakIdentityInput,
  type KeycloakIdentityStore,
} from './identity.js';
import { registerKeycloakAuthRoutes } from './routes.js';

const ROUTE_CONFIG = {
  issuer: 'http://localhost:8180/realms/proctira',
  clientId: 'proctira-gateway',
  realm: 'proctira',
  jwksUri: 'http://localhost:8180/realms/proctira/protocol/openid-connect/certs',
  redirectUri: 'http://localhost:3200/api/v1/auth/callback',
};

function unsignedToken(claims: Record<string, unknown>): string {
  const enc = (value: unknown) => Buffer.from(JSON.stringify(value)).toString('base64url');
  return `${enc({ alg: 'RS256', typ: 'JWT' })}.${enc(claims)}.sig`;
}

function store(overrides: Partial<Record<keyof KeycloakIdentityStore, unknown>> = {}) {
  return {
    findIdentity: vi.fn().mockResolvedValue({
      id: 'identity-1',
      userId: 'user-1',
      tenantId: 'tenant-1',
      email: 'teacher@example.org',
    }),
    touchIdentity: vi.fn().mockResolvedValue(undefined),
    findUserByEmail: vi.fn().mockResolvedValue({
      id: 'user-1',
      tenantId: 'tenant-1',
      email: 'teacher@example.org',
      displayName: 'Teacher',
      countryCode: 'IN',
    }),
    findTenantById: vi.fn(),
    findTenantBySlug: vi.fn(),
    createUser: vi.fn(),
    createIdentity: vi.fn(),
    ...overrides,
  } as unknown as KeycloakIdentityStore & Record<string, ReturnType<typeof vi.fn>>;
}

function mockTokenEndpoint(accessToken: string) {
  return vi.spyOn(globalThis, 'fetch').mockResolvedValue(
    new Response(JSON.stringify({ access_token: accessToken, token_type: 'Bearer' }), {
      status: 200,
      headers: { 'content-type': 'application/json' },
    }),
  );
}

afterEach(() => {
  vi.restoreAllMocks();
  resetIdentityTouchThrottleForTests();
});

/** PRC-M500: the OIDC callback must present the browser-bound state cookie issued by /login. */
async function injectLoginRoute(
  app: ReturnType<typeof Fastify>,
  method: 'GET' | 'POST',
  url: string,
  payload?: Record<string, string>,
) {
  if (method === 'POST') return app.inject({ method, url, ...(payload ? { payload } : {}) });
  const login = await app.inject({ method: 'GET', url: '/api/v1/auth/login' });
  const cookie = String(login.headers['set-cookie']).split(';')[0]!;
  const state = new URL(String(login.headers.location)).searchParams.get('state')!;
  return app.inject({
    method,
    url: `${url}&state=${encodeURIComponent(state)}`,
    headers: { cookie },
  });
}

describe('PRC-L283 login routes fail closed on identity link errors', () => {
  const tokenFor = () =>
    unsignedToken({ sub: 'kc-1', email: 'teacher@example.org', email_verified: true });

  it.each([
    ['GET', '/api/v1/auth/callback?code=abc', undefined],
    ['POST', '/api/v1/auth/password', { username: 'teacher@example.org', password: 'x' }],
  ] as const)('%s %s: identity store outage → 503 and no tokens', async (method, url, payload) => {
    mockTokenEndpoint(tokenFor());
    const app = Fastify({ logger: false });
    await registerKeycloakAuthRoutes(app, {
      ...ROUTE_CONFIG,
      identityStore: store({ findIdentity: vi.fn().mockRejectedValue(new Error('db down')) }),
    });
    const response = await injectLoginRoute(app, method, url, payload);
    expect(response.statusCode).toBe(503);
    expect(response.json()).toMatchObject({ code: 'IDENTITY_UNAVAILABLE' });
    expect(response.body).not.toContain('accessToken');
    await app.close();
  });

  it.each([
    ['GET', '/api/v1/auth/callback?code=abc', undefined],
    ['POST', '/api/v1/auth/password', { username: 'nobody@example.org', password: 'x' }],
  ] as const)(
    '%s %s: rejected mapping (unverified email) → 401, no tokens',
    async (method, url, payload) => {
      mockTokenEndpoint(unsignedToken({ sub: 'kc-2', email: 'nobody@example.org' }));
      const app = Fastify({ logger: false });
      await registerKeycloakAuthRoutes(app, {
        ...ROUTE_CONFIG,
        identityStore: store({ findIdentity: vi.fn().mockResolvedValue(null) }),
      });
      const response = await injectLoginRoute(app, method, url, payload);
      expect(response.statusCode).toBe(401);
      expect(response.json()).toMatchObject({ code: 'IDENTITY_LINK_REJECTED' });
      expect(response.body).not.toContain('accessToken');
      await app.close();
    },
  );
});

describe('PRC-L283 per-session identity cache', () => {
  const input: KeycloakIdentityInput = {
    externalId: 'kc-1',
    email: 'teacher@example.org',
    emailVerified: true,
    realm: 'proctira',
  } as KeycloakIdentityInput;

  it('reads the identity store once per session, not once per request', async () => {
    const s = store();
    const cache = createSessionIdentityCache();
    for (let i = 0; i < 5; i += 1) {
      const linked = await linkKeycloakIdentityForSession(input, s, cache, 'sid-1');
      expect(linked).toMatchObject({ userId: 'user-1', tenantId: 'tenant-1' });
    }
    expect(s.findIdentity).toHaveBeenCalledTimes(1);
    expect(s.findUserByEmail).toHaveBeenCalledTimes(1);
    await linkKeycloakIdentityForSession(input, s, cache, 'sid-2');
    expect(s.findIdentity).toHaveBeenCalledTimes(2);
  });

  it('never caches without a session id, and the key includes the subject', async () => {
    const s = store();
    const cache = createSessionIdentityCache();
    await linkKeycloakIdentityForSession(input, s, cache, undefined);
    await linkKeycloakIdentityForSession(input, s, cache, undefined);
    expect(s.findIdentity).toHaveBeenCalledTimes(2);
    await linkKeycloakIdentityForSession(input, s, cache, 'sid-1');
    expect(cache.get('sid-1', 'kc-other')).toBeUndefined();
  });

  it('expires entries, is bounded, and does not cache failures (outage still fails closed)', async () => {
    let clock = 0;
    const cache = createSessionIdentityCache({ ttlMs: 1000, maxEntries: 2, now: () => clock });
    const user = {
      userId: 'u',
      tenantId: 't',
      email: 'e',
      displayName: 'd',
      countryCode: 'IN',
    };
    cache.set('a', 'x', user);
    cache.set('b', 'x', user);
    cache.set('c', 'x', user);
    expect(cache.size).toBe(2);
    expect(cache.get('a', 'x')).toBeUndefined();
    clock = 1500;
    expect(cache.get('c', 'x')).toBeUndefined();

    const failing = store({ findIdentity: vi.fn().mockRejectedValue(new Error('db down')) });
    const fresh = createSessionIdentityCache();
    await expect(linkKeycloakIdentityForSession(input, failing, fresh, 'sid-9')).rejects.toThrow(
      'db down',
    );
    expect(fresh.size).toBe(0);
  });
});
