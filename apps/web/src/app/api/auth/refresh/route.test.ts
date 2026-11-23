/**
 * @vitest-environment node
 *
 * PRC-M133: behavioural coverage for the refresh proxy — no cookie -> 401,
 * unresolved tenant -> 400, upstream 401 clears auth cookies, transport
 * failure -> 503, and a success rotates both token cookies.
 */
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

const cookieStore = new Map<string, { value: string }>();
vi.mock('next/headers', () => ({
  cookies: () => ({ get: (name: string) => cookieStore.get(name) }),
}));

const resolveTenantForRequest = vi.fn();
vi.mock('@/lib/api/request-tenant', async () => {
  const actual = await vi.importActual<typeof import('@/lib/api/request-tenant')>(
    '@/lib/api/request-tenant',
  );
  return { ...actual, resolveTenantForRequest: (...a: unknown[]) => resolveTenantForRequest(...a) };
});

import { AUTH_COOKIES } from '@/lib/auth/session';
import { POST } from './route';

const ORIGINAL_FETCH = global.fetch;

function req(): Request {
  return new Request('https://school.proctira.io/api/auth/refresh', { method: 'POST' });
}

beforeEach(() => {
  cookieStore.clear();
  resolveTenantForRequest.mockReset().mockReturnValue('tenant-1');
});

afterEach(() => {
  global.fetch = ORIGINAL_FETCH;
  vi.restoreAllMocks();
});

describe('POST /api/auth/refresh (PRC-M133)', () => {
  it('returns 401 when no refresh cookie is present', async () => {
    const res = await POST(req());
    expect(res.status).toBe(401);
  });

  it('returns 400 when the tenant cannot be resolved from the Host', async () => {
    cookieStore.set(AUTH_COOKIES.REFRESH_TOKEN, { value: 'r-tok' });
    resolveTenantForRequest.mockReturnValue(null);
    const res = await POST(req());
    expect(res.status).toBe(400);
  });

  it('clears auth cookies and returns 401 on upstream rejection', async () => {
    cookieStore.set(AUTH_COOKIES.REFRESH_TOKEN, { value: 'r-tok' });
    global.fetch = vi
      .fn()
      .mockResolvedValue(
        new Response(JSON.stringify({ message: 'bad' }), { status: 401 }),
      ) as unknown as typeof fetch;
    const res = await POST(req());
    expect(res.status).toBe(401);
    const setCookie = res.headers.get('set-cookie') ?? '';
    expect(setCookie).toContain(`${AUTH_COOKIES.ACCESS_TOKEN}=`);
  });

  it('returns 503 when the auth service is unreachable', async () => {
    cookieStore.set(AUTH_COOKIES.REFRESH_TOKEN, { value: 'r-tok' });
    global.fetch = vi
      .fn()
      .mockRejectedValue(new TypeError('ECONNREFUSED')) as unknown as typeof fetch;
    const res = await POST(req());
    expect(res.status).toBe(503);
  });

  it('rotates both token cookies on success', async () => {
    cookieStore.set(AUTH_COOKIES.REFRESH_TOKEN, { value: 'r-tok' });
    global.fetch = vi
      .fn()
      .mockResolvedValue(
        new Response(
          JSON.stringify({ tokens: { accessToken: 'A', refreshToken: 'R', expiresIn: 900 } }),
          { status: 200 },
        ),
      ) as unknown as typeof fetch;
    const res = await POST(req());
    expect(res.status).toBe(200);
    await expect(res.json()).resolves.toEqual({ success: true });
    const setCookie = res.headers.get('set-cookie') ?? '';
    expect(setCookie).toContain(`${AUTH_COOKIES.ACCESS_TOKEN}=A`);
    expect(setCookie).toContain(`${AUTH_COOKIES.REFRESH_TOKEN}=R`);
  });
});

describe('POST /api/auth/refresh: Keycloak sessions (UATENV-D16)', () => {
  // Keycloak refresh tokens are JWTs; platform refresh tokens are opaque UUIDs.
  const enc = (value: unknown) => Buffer.from(JSON.stringify(value)).toString('base64url');
  const keycloakRefresh = `${enc({ alg: 'HS512', typ: 'JWT' })}.${enc({
    typ: 'Refresh',
    iss: 'https://keycloak.test/realms/proctira',
    sid: 'kc-session-1',
  })}.sig`;

  beforeEach(() => {
    vi.stubEnv('GATEWAY_URL', 'http://gateway.test');
    vi.stubEnv('AUTH_SERVICE_URL', 'http://gateway.test');
  });

  afterEach(() => {
    vi.unstubAllEnvs();
  });

  it('refreshes through the gateway Keycloak route and reads its top-level tokens', async () => {
    cookieStore.set(AUTH_COOKIES.REFRESH_TOKEN, { value: keycloakRefresh });
    const fetchMock = vi.fn().mockResolvedValue(
      new Response(
        JSON.stringify({
          provider: 'keycloak',
          accessToken: 'KC-A',
          refreshToken: 'KC-R',
          expiresIn: 300,
        }),
        { status: 200 },
      ),
    );
    global.fetch = fetchMock as unknown as typeof fetch;

    const res = await POST(req());

    expect(String(fetchMock.mock.calls[0]?.[0])).toBe('http://gateway.test/api/v1/auth/refresh');
    expect(JSON.parse(String((fetchMock.mock.calls[0]?.[1] as RequestInit).body))).toEqual({
      refreshToken: keycloakRefresh,
    });
    expect(res.status).toBe(200);
    const setCookie = res.headers.get('set-cookie') ?? '';
    expect(setCookie).toContain(`${AUTH_COOKIES.ACCESS_TOKEN}=KC-A`);
    expect(setCookie).toContain(`${AUTH_COOKIES.REFRESH_TOKEN}=KC-R`);
  });

  it('keeps the platform /auth/refresh route for opaque refresh tokens', async () => {
    cookieStore.set(AUTH_COOKIES.REFRESH_TOKEN, { value: 'r-tok' });
    const fetchMock = vi
      .fn()
      .mockResolvedValue(
        new Response(
          JSON.stringify({ tokens: { accessToken: 'A', refreshToken: 'R', expiresIn: 900 } }),
          { status: 200 },
        ),
      );
    global.fetch = fetchMock as unknown as typeof fetch;

    const res = await POST(req());

    expect(String(fetchMock.mock.calls[0]?.[0])).toBe('http://gateway.test/auth/refresh');
    expect(res.status).toBe(200);
  });
});
