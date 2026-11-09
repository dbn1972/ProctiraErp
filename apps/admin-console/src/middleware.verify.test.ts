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
    const s = await session(signedToken({ tenantId: undefined, tenant_id: 'platform' }));
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
