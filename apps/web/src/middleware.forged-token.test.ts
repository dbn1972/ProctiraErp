/**
 * @vitest-environment node
 *
 * PRC-L545: the shipped `middleware()` (not a re-implemented copy) refuses
 * forged, unsigned, HMAC, tampered, wrong-issuer and wrong-audience access
 * tokens, never runs the refresh path for them, and lets an authentic token's
 * tenant claim win over a client X-Tenant-ID header. Positive controls are
 * signed by the local test JWKS.
 */
import { NextRequest } from 'next/server';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { __resetShellTokenVerifierCache } from '@proctira/auth';
import { __resetRefreshSingleFlight, clearTenantConfigCache, middleware } from './middleware';
import {
  TEST_JWKS_ENV,
  forgedToken,
  hmacToken,
  signedToken,
  tamperedToken,
  unsignedToken,
  withTestJwks,
} from './lib/auth/jwks-test-fixture';

const requestedUrls: string[] = [];

const fetchMock = vi.fn(
  withTestJwks(async (input) => {
    const url = typeof input === 'string' ? input : input instanceof URL ? input.href : input.url;
    requestedUrls.push(url);
    if (url.endsWith('/api/v1/tenant/config')) {
      return new Response(JSON.stringify({ id: 'tenant-a', slug: 'acme', active: true }), {
        status: 200,
        headers: { 'content-type': 'application/json' },
      });
    }
    // /api/auth/refresh: a rotated access token cookie.
    return new Response('{}', {
      status: 200,
      headers: { 'set-cookie': 'access_token=rotated; Path=/' },
    });
  }),
);

function navigation(path: string, cookie: string, headers: Record<string, string> = {}) {
  return new NextRequest(`https://acme.proctira.io${path}`, {
    headers: { host: 'acme.proctira.io', cookie, ...headers },
  });
}

function loginRedirect(response: Response): URL | null {
  const location = response.headers.get('location');
  if (!location) return null;
  const url = new URL(location);
  return url.pathname === '/login' ? url : null;
}

const past = () => Math.floor(Date.now() / 1000) - 120;

beforeEach(() => {
  requestedUrls.length = 0;
  clearTenantConfigCache();
  __resetRefreshSingleFlight();
  __resetShellTokenVerifierCache();
  vi.stubGlobal('fetch', fetchMock);
  for (const [k, v] of Object.entries(TEST_JWKS_ENV)) vi.stubEnv(k, v);
});

afterEach(() => {
  vi.unstubAllEnvs();
  vi.unstubAllGlobals();
});

describe('middleware access-token verification (PRC-L545)', () => {
  it('lets an authentic token through (positive control)', async () => {
    const response = await middleware(navigation('/dashboard', `access_token=${signedToken()}`));
    expect(response.headers.get('location')).toBeNull();
    expect(response.headers.get('X-Tenant-ID')).toBe('tenant-a');
  });

  it.each([
    ['forged', () => forgedToken()],
    ['unsigned (alg: none)', () => unsignedToken()],
    ['HMAC', () => hmacToken()],
    ['tampered', () => tamperedToken({ tenantId: 'tenant-b' })],
    ['wrong issuer', () => signedToken({ iss: 'https://evil.test/realms/x' })],
    ['wrong audience', () => signedToken({ azp: 'other-client', aud: 'other-client' })],
  ])('sends a %s token to /login with returnTo', async (_label, mint) => {
    const response = await middleware(navigation('/students', `access_token=${mint()}`));
    const url = loginRedirect(response);
    expect(url).not.toBeNull();
    expect(url?.searchParams.get('returnTo')).toBe('/students');
  });

  it('never refreshes on behalf of a forged expired token', async () => {
    const response = await middleware(
      navigation('/dashboard', `access_token=${forgedToken({ exp: past() })}; refresh_token=rt-1`),
    );
    expect(loginRedirect(response)).not.toBeNull();
    expect(requestedUrls.some((url) => url.includes('/api/auth/refresh'))).toBe(false);
  });

  it('refreshes an authentic expired token and replays the navigation', async () => {
    const response = await middleware(
      navigation('/dashboard', `access_token=${signedToken({ exp: past() })}; refresh_token=rt-1`),
    );
    expect(requestedUrls.some((url) => url.includes('/api/auth/refresh'))).toBe(true);
    expect(response.headers.get('location')).toBe('https://acme.proctira.io/dashboard');
    expect(response.headers.get('set-cookie')).toContain('access_token=rotated');
  });

  it('a forged student token cannot use a role bounce to skip the login gate', async () => {
    const student = forgedToken({ roles: [{ roleId: 'student', roleName: 'Student' }] });
    const response = await middleware(navigation('/parent', `access_token=${student}`));
    expect(loginRedirect(response)).not.toBeNull();
  });

  it('the verified tenant claim wins over a client X-Tenant-ID header', async () => {
    const response = await middleware(
      navigation('/dashboard', `access_token=${signedToken()}`, { 'x-tenant-id': 'tenant-b' }),
    );
    expect(response.headers.get('X-Tenant-ID')).toBe('tenant-a');
    expect(response.headers.get('x-middleware-request-x-tenant-id')).not.toBe('tenant-b');
  });
});
