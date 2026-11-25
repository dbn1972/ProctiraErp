/**
 * UATENV-D23: the console sign-in form must work when the gateway runs in
 * Keycloak mode. There the password grant is `POST /api/v1/auth/password`
 * (tokens at the top level); the platform `POST /auth/login` is not public and
 * answered 401 "Invalid or expired access token", so no admin cookie was set.
 * A gateway without Keycloak has no `/api/v1/auth/password` route (404/502),
 * so the route falls back to the platform `/auth/login`.
 */
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { ADMIN_AUTH_COOKIES } from '@/lib/auth/cookies';

function req(body: unknown = { email: 'operator@proctira.test', password: 'pw' }): Request {
  return new Request('https://admin.proctira.io/api/auth/login', {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify(body),
  });
}
function json(body: unknown, status: number): Response {
  return new Response(JSON.stringify(body), { status });
}
function setCookieValue(res: Response, name: string): string | undefined {
  const all = (res.headers as Headers & { getSetCookie(): string[] }).getSetCookie();
  const entry = all.find((c) => c.startsWith(`${name}=`));
  return entry?.split(';')[0]?.slice(name.length + 1);
}
async function loadPost(): Promise<(request: Request) => Promise<Response>> {
  const mod = await import('./route');
  return mod.POST;
}

beforeEach(() => {
  vi.stubEnv('GATEWAY_URL', 'http://gateway.test');
  vi.stubEnv('AUTH_SERVICE_URL', 'http://gateway.test');
});
afterEach(() => {
  vi.unstubAllEnvs();
  vi.unstubAllGlobals();
  vi.resetModules();
});

describe('POST /api/auth/login (UATENV-D23)', () => {
  it('signs in through the gateway Keycloak password route for the platform tenant', async () => {
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
    vi.stubGlobal('fetch', fetchMock);
    const POST = await loadPost();
    const res = await POST(req());
    expect(fetchMock).toHaveBeenCalledTimes(1);
    expect(String(fetchMock.mock.calls[0]?.[0])).toBe('http://gateway.test/api/v1/auth/password');
    const init = fetchMock.mock.calls[0]?.[1] as RequestInit;
    expect(init.method).toBe('POST');
    expect(new Headers(init.headers).get('X-Tenant-ID')).toBe('platform');
    expect(JSON.parse(String(init.body))).toEqual({
      username: 'operator@proctira.test',
      password: 'pw',
      tenantId: 'platform',
    });
    expect(res.status).toBe(200);
    await expect(res.json()).resolves.toEqual({ success: true });
    expect(setCookieValue(res, ADMIN_AUTH_COOKIES.ACCESS_TOKEN)).toBe('KC-A');
    expect(setCookieValue(res, ADMIN_AUTH_COOKIES.REFRESH_TOKEN)).toBe('KC-R');
  });

  it('returns the gateway rejection without trying the platform route', async () => {
    const fetchMock = vi
      .fn()
      .mockResolvedValue(
        json({ code: 'INVALID_CREDENTIALS', message: 'Invalid email or password' }, 401),
      );
    vi.stubGlobal('fetch', fetchMock);
    const POST = await loadPost();
    const res = await POST(req());
    expect(fetchMock).toHaveBeenCalledTimes(1);
    expect(res.status).toBe(401);
    expect(res.headers.get('set-cookie')).toBeNull();
  });

  it('sets no cookie when the Keycloak route answers 200 without an access token', async () => {
    const fetchMock = vi.fn().mockResolvedValue(json({ status: 'mfa_required' }, 200));
    vi.stubGlobal('fetch', fetchMock);
    const POST = await loadPost();
    const res = await POST(req());
    expect(fetchMock).toHaveBeenCalledTimes(1);
    expect(res.status).toBe(502);
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
              session: { id: 'sess-1' },
            },
            200,
          ),
        );
      vi.stubGlobal('fetch', fetchMock);
      const POST = await loadPost();
      const res = await POST(req());
      expect(fetchMock).toHaveBeenCalledTimes(2);
      expect(String(fetchMock.mock.calls[1]?.[0])).toBe('http://gateway.test/auth/login');
      expect(res.status).toBe(200);
      expect(setCookieValue(res, ADMIN_AUTH_COOKIES.ACCESS_TOKEN)).toBe('A');
      expect(setCookieValue(res, ADMIN_AUTH_COOKIES.REFRESH_TOKEN)).toBe('R');
      expect(setCookieValue(res, ADMIN_AUTH_COOKIES.SESSION_ID)).toBe('sess-1');
    },
  );

  it('returns 503 when the gateway is unreachable', async () => {
    vi.stubGlobal('fetch', vi.fn().mockRejectedValue(new TypeError('ECONNREFUSED')));
    const POST = await loadPost();
    expect((await POST(req())).status).toBe(503);
  });
});
