/**
 * PRC-L202: the console middleware and server session accept only a token
 * whose signature, issuer and audience verify against the IdP JWKS and that
 * was issued for the platform tenant; a platform token without a platform
 * role sees no console page. Base decoded the payload unverified.
 */
import { NextRequest } from 'next/server';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { __resetShellTokenVerifierCache } from '@proctira/auth';
import { ADMIN_AUTH_COOKIES } from './lib/auth/cookies';
import {
  TEST_JWKS_ENV,
  forgedToken,
  hmacToken,
  signedToken,
  unsignedToken,
  withTestJwks,
} from './lib/auth/jwks-test-fixture';
import { middleware } from './middleware';

const cookieJar = new Map<string, string>();
vi.mock('next/headers', () => ({
  cookies: async () => ({
    get: (name: string) => (cookieJar.has(name) ? { value: cookieJar.get(name)! } : undefined),
  }),
}));
vi.mock('next/navigation', () => ({
  redirect: (url: string) => {
    throw new Error(`NEXT_REDIRECT:${url}`);
  },
}));

const fetchMock = vi.fn(withTestJwks(async () => new Response('unexpected', { status: 500 })));

function page(path: string, token?: string): NextRequest {
  const req = new NextRequest(`https://admin.example${path}`);
  if (token) req.cookies.set(ADMIN_AUTH_COOKIES.ACCESS_TOKEN, token);
  return req;
}

function redirectedTo(res: Response): string | null {
  const location = res.headers.get('location');
  return location ? new URL(location).pathname : null;
}

beforeEach(() => {
  cookieJar.clear();
  __resetShellTokenVerifierCache();
  vi.stubGlobal('fetch', fetchMock);
  for (const [k, v] of Object.entries(TEST_JWKS_ENV)) vi.stubEnv(k, v);
});

afterEach(() => {
  vi.unstubAllEnvs();
  vi.unstubAllGlobals();
});

describe('console middleware JWKS verification (PRC-L202)', () => {
  it('lets an authentic platform token through (positive control)', async () => {
    expect(redirectedTo(await middleware(page('/tenants', signedToken())))).toBeNull();
  });

  it.each([
    ['forged', () => forgedToken()],
    ['unsigned (alg: none)', () => unsignedToken()],
    ['HMAC', () => hmacToken()],
    ['wrong issuer', () => signedToken({ iss: 'https://evil.test' })],
    ['wrong audience', () => signedToken({ azp: 'other', aud: 'other' })],
    ['tenant (non-platform)', () => signedToken({ tenantId: 'tenant-a' })],
  ])('sends a %s token to /login', async (_label, mint) => {
    expect(redirectedTo(await middleware(page('/tenants', mint())))).toBe('/login');
  });

  it('fails closed in a deployed stage with no JWKS configured', async () => {
    vi.stubEnv('KEYCLOAK_ISSUER', '');
    vi.stubEnv('APP_ENV', 'production');
    expect(redirectedTo(await middleware(page('/tenants', signedToken())))).toBe('/login');
  });
});

describe('console server session (PRC-L202)', () => {
  async function session(token: string) {
    cookieJar.set(ADMIN_AUTH_COOKIES.ACCESS_TOKEN, token);
    const { getSession } = await import('./lib/auth/server');
    return getSession();
  }

  it('returns the operator for an authentic platform token', async () => {
    const s = await session(signedToken());
    expect(s?.user.platformRole).toBe('platform_admin');
    expect(s?.user.tenantId).toBe('platform');
  });

  it('reads the Keycloak tenant_id claim', async () => {
    const s = await session(
      signedToken({
        tenantId: undefined,
        tenant_id: 'platform',
        roles: undefined,
        realm_access: { roles: ['platform_admin'] },
      }),
    );
    expect(s?.user.platformRole).toBe('platform_admin');
  });

  it.each([
    ['forged', () => forgedToken()],
    ['unsigned', () => unsignedToken()],
    [
      'tenant token with super-admin',
      () => signedToken({ tenantId: 't-1', roles: ['super-admin'] }),
    ],
  ])('returns no session for a %s token', async (_label, mint) => {
    expect(await session(mint())).toBeNull();
  });

  it('requireSession sends a platform token without a platform role to /forbidden', async () => {
    cookieJar.set(ADMIN_AUTH_COOKIES.ACCESS_TOKEN, signedToken({ roles: ['teacher'] }));
    const { requireSession } = await import('./lib/auth/server');
    await expect(requireSession()).rejects.toThrow('NEXT_REDIRECT:/forbidden');
  });
});

/**
 * UATENV-D33: a Keycloak realm token carries the platform role only in
 * `realm_access.roles` (no top-level `roles`). The console read `roles` only, so
 * the signed-in operator was sent to /forbidden on every page. Claim set of the
 * UAT operator token: tenant_id=platform, tenant_slug=platform, realm roles.
 */
describe('console role from Keycloak realm roles (UATENV-D33)', () => {
  /** Shape of the UAT `uat-platform-operator` access token. */
  function keycloakOperator(extra: Record<string, unknown> = {}): string {
    return signedToken({
      tenantId: undefined,
      roles: undefined,
      email: undefined,
      tenant_id: 'platform',
      tenant_slug: 'platform',
      typ: 'Bearer',
      scope: 'openid profile email',
      realm_access: { roles: ['offline_access', 'uma_authorization', 'platform_admin'] },
      resource_access: { account: { roles: ['manage-account'] } },
      ...extra,
    });
  }

  it('requireSession accepts the platform operator', async () => {
    cookieJar.set(ADMIN_AUTH_COOKIES.ACCESS_TOKEN, keycloakOperator());
    const { requireSession } = await import('./lib/auth/server');
    const s = await requireSession('/tenants');
    expect(s.user.platformRole).toBe('platform_admin');
  });

  it.each(['tenants', 'plans', 'plugins', 'themes', 'support', 'health', 'audit'] as const)(
    'requireRole(%s) lets the platform operator in',
    async (area) => {
      cookieJar.set(ADMIN_AUTH_COOKIES.ACCESS_TOKEN, keycloakOperator());
      const { requireRole } = await import('./lib/auth/server');
      await expect(requireRole(area)).resolves.toMatchObject({
        user: { platformRole: 'platform_admin' },
      });
    },
  );

  it('maps a functional realm role (billing) and still enforces the area', async () => {
    cookieJar.set(
      ADMIN_AUTH_COOKIES.ACCESS_TOKEN,
      keycloakOperator({ realm_access: { roles: ['billing'] } }),
    );
    const { requireRole } = await import('./lib/auth/server');
    await expect(requireRole('tenants')).resolves.toMatchObject({
      user: { platformRole: 'billing' },
    });
    await expect(requireRole('plugins')).rejects.toThrow('NEXT_REDIRECT:/forbidden?area=plugins');
  });

  it('reads client roles only for the token’s own client (azp)', async () => {
    const own = keycloakOperator({
      realm_access: { roles: [] },
      resource_access: { 'proctira-gateway': { roles: ['security'] } },
    });
    cookieJar.set(ADMIN_AUTH_COOKIES.ACCESS_TOKEN, own);
    const { getSession } = await import('./lib/auth/server');
    expect((await getSession())?.user.platformRole).toBe('security');

    cookieJar.set(
      ADMIN_AUTH_COOKIES.ACCESS_TOKEN,
      keycloakOperator({
        realm_access: { roles: [] },
        resource_access: { 'other-app': { roles: ['platform_admin'] } },
      }),
    );
    const { requireSession } = await import('./lib/auth/server');
    await expect(requireSession()).rejects.toThrow('NEXT_REDIRECT:/forbidden');
  });

  it('ignores unpinned top-level roles/platformRole on a Keycloak token (PRC-M178)', async () => {
    cookieJar.set(
      ADMIN_AUTH_COOKIES.ACCESS_TOKEN,
      keycloakOperator({
        realm_access: { roles: ['offline_access'] },
        roles: ['platform_admin'],
        platformRole: 'platform_admin',
      }),
    );
    const { requireSession } = await import('./lib/auth/server');
    await expect(requireSession()).rejects.toThrow('NEXT_REDIRECT:/forbidden');
  });

  it('opens console pages through the middleware for the operator', async () => {
    expect(redirectedTo(await middleware(page('/tenants', keycloakOperator())))).toBeNull();
  });

  // #790 / UATENV-D30 rule: platform role names on a tenant token grant nothing.
  it.each([
    ['tenant UUID', '5a58f9ff-b6a6-43bd-a014-bb622f763e48'],
    ['tenant slug', 'sunrise-public-school'],
  ])('refuses a tenant Keycloak token with platform realm roles (%s)', async (_label, tenantId) => {
    const tenantToken = keycloakOperator({
      tenant_id: tenantId,
      tenant_slug: 'sunrise-public-school',
      realm_access: { roles: ['platform_admin', 'super-admin'] },
    });
    expect(redirectedTo(await middleware(page('/tenants', tenantToken)))).toBe('/login');
    cookieJar.set(ADMIN_AUTH_COOKIES.ACCESS_TOKEN, tenantToken);
    const { getSession, requireSession } = await import('./lib/auth/server');
    expect(await getSession()).toBeNull();
    await expect(requireSession('/tenants')).rejects.toThrow(
      'NEXT_REDIRECT:/login?returnTo=%2Ftenants',
    );
  });
});
