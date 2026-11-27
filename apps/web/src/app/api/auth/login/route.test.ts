/**
 * @vitest-environment node
 *
 * UATENV-D08: the email/password form must work when the gateway runs in
 * Keycloak mode. There the password grant is `POST /api/v1/auth/password`
 * (tokens at the top level); the platform `POST /auth/login` is not public and
 * answered 401 "Invalid or expired access token". The gateway without Keycloak
 * has no `/api/v1/auth/password` route (404), so the route falls back to the
 * platform `/auth/login`.
 */
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

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

function req(body: unknown = { email: 'teacher@school.test', password: 'pw' }): Request {
  return new Request('https://school.proctira.io/api/auth/login', {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify(body),
  });
}

function json(body: unknown, status: number): Response {
  return new Response(JSON.stringify(body), { status });
}

beforeEach(() => {
  resolveTenantForRequest.mockReset().mockReturnValue('tenant-1');
  vi.stubEnv('GATEWAY_URL', 'http://gateway.test');
  vi.stubEnv('AUTH_SERVICE_URL', 'http://gateway.test');
});

afterEach(() => {
  global.fetch = ORIGINAL_FETCH;
  vi.unstubAllEnvs();
  vi.restoreAllMocks();
});

describe('POST /api/auth/login (UATENV-D08)', () => {
  it('signs in through the gateway Keycloak password route', async () => {
    const fetchMock = vi.fn().mockResolvedValue(
      json(
        {
          provider: 'keycloak',
          accessToken: 'KC-A',
          refreshToken: 'KC-R',
          expiresIn: 300,
          tokenType: 'Bearer',
        },
        200,
      ),
    );
    global.fetch = fetchMock as unknown as typeof fetch;

    const res = await POST(req());

    expect(fetchMock).toHaveBeenCalledTimes(1);
    expect(String(fetchMock.mock.calls[0]?.[0])).toBe('http://gateway.test/api/v1/auth/password');
    expect(JSON.parse(String((fetchMock.mock.calls[0]?.[1] as RequestInit).body))).toEqual({
      username: 'teacher@school.test',
      password: 'pw',
    });
    expect(res.status).toBe(200);
    await expect(res.json()).resolves.toEqual({ success: true });
    const setCookie = res.headers.get('set-cookie') ?? '';
    expect(setCookie).toContain(`${AUTH_COOKIES.ACCESS_TOKEN}=KC-A`);
    expect(setCookie).toContain(`${AUTH_COOKIES.REFRESH_TOKEN}=KC-R`);
  });

  it('returns the gateway rejection without trying the platform route', async () => {
    const fetchMock = vi
      .fn()
      .mockResolvedValue(
        json({ code: 'INVALID_CREDENTIALS', message: 'Invalid email or password' }, 401),
      );
    global.fetch = fetchMock as unknown as typeof fetch;

    const res = await POST(req());

    expect(fetchMock).toHaveBeenCalledTimes(1);
    expect(res.status).toBe(401);
    expect(res.headers.get('set-cookie')).toBeNull();
  });

  it.each([404, 502])(
    'falls back to the platform /auth/login when the gateway answers %i (no Keycloak route)',
    async (status) => {
      const fetchMock = vi
        .fn()
        .mockResolvedValueOnce(json({ message: 'Route not found' }, status))
        .mockResolvedValueOnce(
          json(
            {
              tokens: { accessToken: 'A', refreshToken: 'R', expiresIn: 900 },
              session: { id: 'sess-1', expiresAt: '2030-01-01T00:00:00Z' },
            },
            200,
          ),
        );
      global.fetch = fetchMock as unknown as typeof fetch;

      const res = await POST(req());

      expect(String(fetchMock.mock.calls[1]?.[0])).toBe('http://gateway.test/auth/login');
      expect(res.status).toBe(200);
      const setCookie = res.headers.get('set-cookie') ?? '';
      expect(setCookie).toContain(`${AUTH_COOKIES.ACCESS_TOKEN}=A`);
      expect(setCookie).toContain(`${AUTH_COOKIES.SESSION_ID}=sess-1`);
    },
  );

  it('returns 503 when the gateway is unreachable', async () => {
    global.fetch = vi
      .fn()
      .mockRejectedValue(new TypeError('ECONNREFUSED')) as unknown as typeof fetch;
    expect((await POST(req())).status).toBe(503);
  });
});

describe('POST /api/auth/login platform operator accounts (UATENV-D23)', () => {
  const token = (claims: Record<string, unknown>) =>
    [
      Buffer.from(JSON.stringify({ alg: 'RS256' })).toString('base64url'),
      Buffer.from(JSON.stringify(claims)).toString('base64url'),
      'sig',
    ].join('.');

  it('refuses a platform operator token on a school host and sets no cookie', async () => {
    global.fetch = vi
      .fn()
      .mockResolvedValue(
        json({ accessToken: token({ sub: 'op', tenant_id: 'platform' }), refreshToken: 'R' }, 200),
      ) as unknown as typeof fetch;

    const res = await POST(req({ email: 'ops@proctira-uat.test', password: 'pw' }));

    expect(res.status).toBe(403);
    await expect(res.json()).resolves.toMatchObject({ code: 'PLATFORM_ACCOUNT_NOT_ALLOWED' });
    expect(res.headers.get('set-cookie')).toBeNull();
  });

  it('still signs in a school account whose token names its tenant', async () => {
    global.fetch = vi
      .fn()
      .mockResolvedValue(
        json({ accessToken: token({ sub: 't', tenant_id: 'tenant-1' }), refreshToken: 'R' }, 200),
      ) as unknown as typeof fetch;

    const res = await POST(req());

    expect(res.status).toBe(200);
    expect(res.headers.get('set-cookie') ?? '').toContain(`${AUTH_COOKIES.ACCESS_TOKEN}=`);
  });
});
