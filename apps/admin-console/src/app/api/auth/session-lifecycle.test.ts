/**
 * PRC-M464: the console uses its refresh token and revokes upstream on
 * logout. Base had no refresh route (an expired token always forced a new
 * sign-in) and logout only cleared local cookies.
 */
import { NextRequest } from 'next/server';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { __resetShellTokenVerifierCache } from '@proctira/auth';
import { ADMIN_AUTH_COOKIES } from '@/lib/auth/cookies';
import {
  TEST_JWKS_ENV,
  forgedToken,
  signedToken,
  withTestJwks,
} from '@/lib/auth/jwks-test-fixture';

const cookieJar = new Map<string, string>();
vi.mock('next/headers', () => ({
  cookies: async () => ({
    get: (name: string) => (cookieJar.has(name) ? { value: cookieJar.get(name)! } : undefined),
  }),
}));

interface Call {
  url: string;
  init?: RequestInit;
}
const calls: Call[] = [];
let upstream: (url: string) => Response = () => new Response('{}', { status: 200 });

const fetchMock = vi.fn(
  withTestJwks(async (input, init) => {
    const url = typeof input === 'string' ? input : input instanceof URL ? input.href : input.url;
    calls.push({ url, init });
    return upstream(url);
  }),
);

beforeEach(() => {
  cookieJar.clear();
  calls.length = 0;
  upstream = () => new Response('{}', { status: 200 });
  __resetShellTokenVerifierCache();
  vi.stubGlobal('fetch', fetchMock);
  for (const [k, v] of Object.entries(TEST_JWKS_ENV)) vi.stubEnv(k, v);
  vi.stubEnv('AUTH_SERVICE_URL', 'http://auth.internal');
  vi.stubEnv('NEXT_PUBLIC_GATEWAY_URL', 'http://gateway.internal');
});

afterEach(() => {
  vi.unstubAllEnvs();
  vi.unstubAllGlobals();
  vi.resetModules();
});

function setCookieValue(res: Response, name: string): string | undefined {
  const all = (res.headers as Headers & { getSetCookie(): string[] }).getSetCookie();
  const entry = all.find((c) => c.startsWith(`${name}=`));
  return entry?.split(';')[0]?.slice(name.length + 1);
}

describe('POST /api/auth/refresh (PRC-M464)', () => {
  it('rotates both cookies through the auth service for the platform tenant', async () => {
    const atNew = signedToken();
    cookieJar.set(ADMIN_AUTH_COOKIES.REFRESH_TOKEN, 'rt-old');
    upstream = () =>
      new Response(
        JSON.stringify({
          tokens: { accessToken: atNew, refreshToken: 'rt-new', expiresIn: 900 },
        }),
        { status: 200 },
      );
    const { POST } = await import('./refresh/route');
    const res = await POST();
    expect(res.status).toBe(200);
    expect(calls).toHaveLength(1);
    expect(calls[0]!.url).toBe('http://auth.internal/auth/refresh');
    expect(new Headers(calls[0]!.init?.headers).get('X-Tenant-ID')).toBe('platform');
    expect(JSON.parse(String(calls[0]!.init?.body))).toEqual({ refreshToken: 'rt-old' });
    expect(setCookieValue(res, ADMIN_AUTH_COOKIES.ACCESS_TOKEN)).toBe(atNew);
    expect(setCookieValue(res, ADMIN_AUTH_COOKIES.REFRESH_TOKEN)).toBe('rt-new');
  });

  it('clears every cookie and returns 401 when the auth service refuses', async () => {
    cookieJar.set(ADMIN_AUTH_COOKIES.REFRESH_TOKEN, 'rt-revoked');
    upstream = () =>
      new Response(JSON.stringify({ code: 'INVALID_REFRESH_TOKEN' }), { status: 401 });
    const { POST } = await import('./refresh/route');
    const res = await POST();
    expect(res.status).toBe(401);
    expect(setCookieValue(res, ADMIN_AUTH_COOKIES.ACCESS_TOKEN)).toBe('');
    expect(setCookieValue(res, ADMIN_AUTH_COOKIES.REFRESH_TOKEN)).toBe('');
  });

  it('returns 401 without calling upstream when there is no refresh cookie', async () => {
    const { POST } = await import('./refresh/route');
    expect((await POST()).status).toBe(401);
    expect(calls).toHaveLength(0);
  });
});

/**
 * UATENV-D34: a Keycloak session (its refresh token is a JWT; platform refresh
 * tokens are opaque) was posted to the platform `/auth/refresh`, which answered
 * 401, so the operator was signed out when the 5-minute access token expired.
 * It now refreshes through the gateway Keycloak route, as the web BFF does
 * (UATENV-D16).
 */
describe('POST /api/auth/refresh: Keycloak sessions (UATENV-D34)', () => {
  /** Keycloak refresh tokens are JWTs (decodable payload). */
  const kcRefresh = (n: number) =>
    `${Buffer.from('{"alg":"HS512","typ":"JWT"}').toString('base64url')}.${Buffer.from(
      JSON.stringify({ typ: 'Refresh', sid: `s-${n}`, exp: 9_999_999_999 }),
    ).toString('base64url')}.sig`;
  const platformAccess = () =>
    signedToken({
      tenantId: undefined,
      roles: undefined,
      tenant_id: 'platform',
      realm_access: { roles: ['platform_admin'] },
    });

  it('refreshes through the gateway /api/v1/auth/refresh and rotates both cookies', async () => {
    const at = platformAccess();
    cookieJar.set(ADMIN_AUTH_COOKIES.REFRESH_TOKEN, kcRefresh(1));
    upstream = () =>
      new Response(
        JSON.stringify({
          provider: 'keycloak',
          accessToken: at,
          refreshToken: kcRefresh(2),
          expiresIn: 300,
        }),
        { status: 200 },
      );
    const { POST } = await import('./refresh/route');
    const res = await POST();
    expect(res.status).toBe(200);
    const refreshCalls = calls.filter((c) => !c.url.includes('/protocol/openid-connect/certs'));
    expect(refreshCalls.map((c) => c.url)).toEqual(['http://gateway.internal/api/v1/auth/refresh']);
    expect(refreshCalls[0]!.init?.method).toBe('POST');
    expect(new Headers(refreshCalls[0]!.init?.headers).get('X-Tenant-ID')).toBe('platform');
    expect(JSON.parse(String(refreshCalls[0]!.init?.body))).toEqual({ refreshToken: kcRefresh(1) });
    expect(setCookieValue(res, ADMIN_AUTH_COOKIES.ACCESS_TOKEN)).toBe(at);
    expect(setCookieValue(res, ADMIN_AUTH_COOKIES.REFRESH_TOKEN)).toBe(kcRefresh(2));
  });

  it('keeps the presented refresh token when the gateway does not rotate it', async () => {
    const at = platformAccess();
    cookieJar.set(ADMIN_AUTH_COOKIES.REFRESH_TOKEN, kcRefresh(3));
    upstream = () =>
      new Response(JSON.stringify({ accessToken: at, expiresIn: 300 }), { status: 200 });
    const { POST } = await import('./refresh/route');
    const res = await POST();
    expect(res.status).toBe(200);
    expect(setCookieValue(res, ADMIN_AUTH_COOKIES.ACCESS_TOKEN)).toBe(at);
    expect(setCookieValue(res, ADMIN_AUTH_COOKIES.REFRESH_TOKEN)).toBe(kcRefresh(3));
  });

  it('clears every cookie and returns 401 when the gateway refuses', async () => {
    cookieJar.set(ADMIN_AUTH_COOKIES.REFRESH_TOKEN, kcRefresh(4));
    upstream = () =>
      new Response(JSON.stringify({ code: 'KEYCLOAK_REFRESH_FAILED' }), { status: 401 });
    const { POST } = await import('./refresh/route');
    const res = await POST();
    expect(res.status).toBe(401);
    expect(setCookieValue(res, ADMIN_AUTH_COOKIES.ACCESS_TOKEN)).toBe('');
    expect(setCookieValue(res, ADMIN_AUTH_COOKIES.REFRESH_TOKEN)).toBe('');
  });

  // #790 / UATENV-D30: a refresh never installs a token the console would refuse.
  it.each([
    ['tenant token', () => signedToken({ tenantId: undefined, tenant_id: 'tenant-a-id' })],
    ['forged token', () => forgedToken()],
  ])('refuses a refreshed %s and clears the cookies', async (_label, mint) => {
    cookieJar.set(ADMIN_AUTH_COOKIES.REFRESH_TOKEN, kcRefresh(5));
    upstream = () =>
      new Response(JSON.stringify({ accessToken: mint(), refreshToken: kcRefresh(6) }), {
        status: 200,
      });
    const { POST } = await import('./refresh/route');
    const res = await POST();
    expect(res.status).toBe(401);
    expect(setCookieValue(res, ADMIN_AUTH_COOKIES.ACCESS_TOKEN)).toBe('');
    expect(setCookieValue(res, ADMIN_AUTH_COOKIES.REFRESH_TOKEN)).toBe('');
  });
});

describe('POST /api/auth/logout (PRC-M464)', () => {
  it('revokes upstream with the bearer and refresh token, then clears cookies', async () => {
    cookieJar.set(ADMIN_AUTH_COOKIES.ACCESS_TOKEN, 'at-1');
    cookieJar.set(ADMIN_AUTH_COOKIES.REFRESH_TOKEN, 'rt-1');
    const { POST } = await import('./logout/route');
    const res = await POST();
    expect(calls).toHaveLength(1);
    expect(calls[0]!.url).toMatch(/\/api\/v1\/auth\/logout$/);
    expect(calls[0]!.init?.method).toBe('POST');
    const headers = new Headers(calls[0]!.init?.headers);
    expect(headers.get('Authorization')).toBe('Bearer at-1');
    expect(headers.get('X-Tenant-ID')).toBe('platform');
    expect(JSON.parse(String(calls[0]!.init?.body))).toEqual({ refreshToken: 'rt-1' });
    expect(setCookieValue(res, ADMIN_AUTH_COOKIES.ACCESS_TOKEN)).toBe('');
    expect(setCookieValue(res, ADMIN_AUTH_COOKIES.REFRESH_TOKEN)).toBe('');
  });

  it('still clears cookies when the upstream revoke fails', async () => {
    cookieJar.set(ADMIN_AUTH_COOKIES.ACCESS_TOKEN, 'at-1');
    upstream = () => {
      throw new Error('ECONNREFUSED');
    };
    const { POST } = await import('./logout/route');
    const res = await POST();
    expect(res.status).toBe(200);
    expect(setCookieValue(res, ADMIN_AUTH_COOKIES.ACCESS_TOKEN)).toBe('');
  });
});

describe('console middleware refresh (PRC-M464)', () => {
  const expired = () => signedToken({ exp: Math.floor(Date.now() / 1000) - 120 });

  function page(cookie: string) {
    return new NextRequest('https://admin.example/tenants', { headers: { cookie } });
  }

  it('rotates an authentic expired token and replays the navigation', async () => {
    upstream = (url) =>
      url.endsWith('/api/auth/refresh')
        ? new Response('{}', {
            status: 200,
            headers: { 'set-cookie': `${ADMIN_AUTH_COOKIES.ACCESS_TOKEN}=rotated; Path=/` },
          })
        : new Response('{}', { status: 500 });
    const { middleware, __resetConsoleRefreshSingleFlight } = await import('@/middleware');
    __resetConsoleRefreshSingleFlight();
    const res = await middleware(
      page(
        `${ADMIN_AUTH_COOKIES.ACCESS_TOKEN}=${expired()}; ${ADMIN_AUTH_COOKIES.REFRESH_TOKEN}=rt-1`,
      ),
    );
    expect(calls.map((c) => c.url)).toContain('https://admin.example/api/auth/refresh');
    expect(res.headers.get('location')).toBe('https://admin.example/tenants');
    expect(res.headers.get('set-cookie')).toContain('rotated');
  });

  it('sends the operator to /login when the refresh fails', async () => {
    upstream = () => new Response('{}', { status: 401 });
    const { middleware, __resetConsoleRefreshSingleFlight } = await import('@/middleware');
    __resetConsoleRefreshSingleFlight();
    const res = await middleware(
      page(
        `${ADMIN_AUTH_COOKIES.ACCESS_TOKEN}=${expired()}; ${ADMIN_AUTH_COOKIES.REFRESH_TOKEN}=rt-2`,
      ),
    );
    expect(new URL(res.headers.get('location')!).pathname).toBe('/login');
  });
});

/**
 * UATENV-D34 (mirror of web UATENV-D18): the access cookie's maxAge equals the
 * access-token lifetime, so after an idle period the browser has dropped it
 * while the refresh cookie is still valid. The middleware sent that navigation
 * to /login without trying the refresh token.
 */
describe('console middleware: only the refresh cookie left (UATENV-D34)', () => {
  function page(cookie: string) {
    return new NextRequest('https://admin.example/tenants', { headers: { cookie } });
  }

  it('refreshes and replays the navigation', async () => {
    upstream = (url) =>
      url.endsWith('/api/auth/refresh')
        ? new Response('{}', {
            status: 200,
            headers: { 'set-cookie': `${ADMIN_AUTH_COOKIES.ACCESS_TOKEN}=rotated; Path=/` },
          })
        : new Response('{}', { status: 500 });
    const { middleware, __resetConsoleRefreshSingleFlight } = await import('@/middleware');
    __resetConsoleRefreshSingleFlight();
    const res = await middleware(page(`${ADMIN_AUTH_COOKIES.REFRESH_TOKEN}=rt-idle-1`));
    expect(calls.map((c) => c.url)).toEqual(['https://admin.example/api/auth/refresh']);
    expect(new Headers(calls[0]!.init?.headers).get('cookie')).toContain(
      `${ADMIN_AUTH_COOKIES.REFRESH_TOKEN}=rt-idle-1`,
    );
    expect(res.headers.get('location')).toBe('https://admin.example/tenants');
    expect(res.headers.get('set-cookie')).toContain('rotated');
  });

  it('sends the operator to /login and clears the cookies when the refresh is refused', async () => {
    upstream = () => new Response('{}', { status: 401 });
    const { middleware, __resetConsoleRefreshSingleFlight } = await import('@/middleware');
    __resetConsoleRefreshSingleFlight();
    const res = await middleware(page(`${ADMIN_AUTH_COOKIES.REFRESH_TOKEN}=rt-idle-2`));
    expect(new URL(res.headers.get('location')!).pathname).toBe('/login');
    const cleared = (res.headers as Headers & { getSetCookie(): string[] }).getSetCookie();
    expect(cleared.some((c) => c.startsWith(`${ADMIN_AUTH_COOKIES.REFRESH_TOKEN}=;`))).toBe(true);
  });

  it('sends a navigation with no auth cookie to /login without a refresh call', async () => {
    const { middleware, __resetConsoleRefreshSingleFlight } = await import('@/middleware');
    __resetConsoleRefreshSingleFlight();
    const res = await middleware(page('other=1'));
    expect(calls).toHaveLength(0);
    expect(new URL(res.headers.get('location')!).pathname).toBe('/login');
  });

  it('does not refresh when the access token is present but does not verify', async () => {
    const { middleware, __resetConsoleRefreshSingleFlight } = await import('@/middleware');
    __resetConsoleRefreshSingleFlight();
    const res = await middleware(
      page(
        `${ADMIN_AUTH_COOKIES.ACCESS_TOKEN}=${forgedToken()}; ${ADMIN_AUTH_COOKIES.REFRESH_TOKEN}=rt-idle-3`,
      ),
    );
    expect(calls).toHaveLength(0);
    expect(new URL(res.headers.get('location')!).pathname).toBe('/login');
  });
});
