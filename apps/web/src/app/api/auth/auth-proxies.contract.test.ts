/**
 * @vitest-environment node
 *
 * PRC-M133: the login, callback and MFA-verify BFF proxies, driven with the
 * gateway's real `/auth` response shapes:
 *
 * - `POST /auth/login` (packages/backend/auth/src/routes.ts): 200
 *   `{ tokens: { accessToken, refreshToken, expiresIn }, session: { id, expiresAt }, user }`;
 *   401 `INVALID_CREDENTIALS`; 200 `{ status: 'mfa_required', preMfaTicket, expiresIn }`
 *   when a second factor is required (PRC-M497).
 * - `GET /api/v1/auth/ticket` (keycloak/routes.ts): 200
 *   `{ accessToken, refreshToken, idToken, expiresIn, tokenType }`; 401 for an unknown ticket.
 * - `POST /auth/mfa/verify` (mfa-routes.ts): 200
 *   `{ success, method, tokens, session }`; 401 `INVALID_OTP`-style errors.
 */
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { AUTH_COOKIES } from '@/lib/auth/session';

const fetchMock = vi.fn<(input: RequestInfo | URL, init?: RequestInit) => Promise<Response>>();

beforeEach(() => {
  fetchMock.mockReset();
  vi.stubGlobal('fetch', fetchMock);
  vi.stubEnv('AUTH_SERVICE_URL', 'http://gateway.internal');
  vi.stubEnv('GATEWAY_URL', 'http://gateway.internal');
  vi.stubEnv('TENANT_BASE_DOMAIN', 'proctira.io');
});

afterEach(() => {
  vi.unstubAllEnvs();
  vi.unstubAllGlobals();
});

function json(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { 'content-type': 'application/json' },
  });
}

function cookieValue(res: Response, name: string): string | undefined {
  const all = (res.headers as Headers & { getSetCookie(): string[] }).getSetCookie();
  const hit = all.find((c) => c.startsWith(`${name}=`));
  return hit?.split(';')[0]?.slice(name.length + 1);
}

const TOKENS = { accessToken: 'at-1', refreshToken: 'rt-1', expiresIn: 900 };

describe('POST /api/auth/login against the gateway contract (PRC-M133)', () => {
  function login(body: unknown, host = 'acme.proctira.io'): Request {
    return new Request(`https://${host}/api/auth/login`, {
      method: 'POST',
      headers: { host, 'content-type': 'application/json', 'x-tenant-id': 'victim' },
      body: JSON.stringify(body),
    });
  }

  it('forwards username/password with the Host tenant and stores the issued tokens', async () => {
    fetchMock.mockResolvedValue(
      json({
        tokens: TOKENS,
        session: { id: 'sess-1', expiresAt: '2026-10-29T00:00:00.000Z' },
        user: { userId: 'u-1' },
      }),
    );
    const { POST } = await import('./login/route');
    const res = await POST(login({ email: 'a@acme.test', password: 'pw' }));
    expect(res.status).toBe(200);
    const [url, init] = fetchMock.mock.calls[0]!;
    expect(String(url)).toBe('http://gateway.internal/auth/login');
    expect(new Headers(init?.headers).get('X-Tenant-ID')).toBe('acme');
    expect(JSON.parse(String(init?.body))).toEqual({ username: 'a@acme.test', password: 'pw' });
    expect(cookieValue(res, AUTH_COOKIES.ACCESS_TOKEN)).toBe('at-1');
    expect(cookieValue(res, AUTH_COOKIES.REFRESH_TOKEN)).toBe('rt-1');
    expect(cookieValue(res, AUTH_COOKIES.SESSION_ID)).toBe('sess-1');
  });

  it('passes the gateway 401 through and sets no cookie', async () => {
    fetchMock.mockResolvedValue(
      json({ code: 'INVALID_CREDENTIALS', message: 'Invalid credentials', statusCode: 401 }, 401),
    );
    const { POST } = await import('./login/route');
    const res = await POST(login({ email: 'a@acme.test', password: 'bad' }));
    expect(res.status).toBe(401);
    expect(await res.json()).toMatchObject({ code: 'INVALID_CREDENTIALS' });
    expect(cookieValue(res, AUTH_COOKIES.ACCESS_TOKEN)).toBeUndefined();
  });

  it('never opens a session for a pre-MFA response (status: mfa_required)', async () => {
    fetchMock.mockResolvedValue(
      json({ status: 'mfa_required', preMfaTicket: 'pmt-1', expiresIn: 300 }),
    );
    const { POST } = await import('./login/route');
    const res = await POST(login({ email: 'a@acme.test', password: 'pw' }));
    expect(res.status).toBeGreaterThanOrEqual(400);
    expect(cookieValue(res, AUTH_COOKIES.ACCESS_TOKEN)).toBeUndefined();
    expect(cookieValue(res, AUTH_COOKIES.REFRESH_TOKEN)).toBeUndefined();
  });

  it('rejects a missing body field without calling the gateway', async () => {
    const { POST } = await import('./login/route');
    expect((await POST(login({ email: 'a@acme.test' }))).status).toBe(400);
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it('refuses an unresolved tenant (localhost) without calling the gateway', async () => {
    const { POST } = await import('./login/route');
    const res = await POST(login({ email: 'a@x.test', password: 'pw' }, 'localhost:3001'));
    expect(res.status).toBe(400);
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it('maps a transport failure to 503', async () => {
    fetchMock.mockRejectedValue(new Error('ECONNREFUSED'));
    const { POST } = await import('./login/route');
    expect((await POST(login({ email: 'a@acme.test', password: 'pw' }))).status).toBe(503);
  });
});

describe('GET /api/auth/callback against the gateway ticket contract (PRC-M133)', () => {
  function callback(query: string): Request {
    return new Request(`https://acme.proctira.io/api/auth/callback?${query}`);
  }

  it('redeems the one-time ticket and stores the issued tokens', async () => {
    fetchMock.mockResolvedValue(json({ ...TOKENS, idToken: 'id-1', tokenType: 'Bearer' }));
    const { GET } = await import('./callback/route');
    const res = await GET(callback('ticket=t-123&returnTo=%2Fstudents'));
    const [url] = fetchMock.mock.calls[0]!;
    expect(String(url)).toBe('http://gateway.internal/api/v1/auth/ticket?ticket=t-123');
    expect(new URL(res.headers.get('location')!).pathname).toBe('/students');
    expect(cookieValue(res, AUTH_COOKIES.ACCESS_TOKEN)).toBe('at-1');
    expect(cookieValue(res, AUTH_COOKIES.REFRESH_TOKEN)).toBe('rt-1');
  });

  it('sends an invalid or expired ticket back to /login with no cookie', async () => {
    fetchMock.mockResolvedValue(
      json({ code: 'INVALID_TICKET', message: 'Login ticket is invalid or expired' }, 401),
    );
    const { GET } = await import('./callback/route');
    const res = await GET(callback('ticket=t-x'));
    const location = new URL(res.headers.get('location')!);
    expect(location.pathname).toBe('/login');
    expect(location.searchParams.get('error')).toBe('ticket_invalid');
    expect(cookieValue(res, AUTH_COOKIES.ACCESS_TOKEN)).toBeUndefined();
  });

  it('does not follow an off-site returnTo', async () => {
    fetchMock.mockResolvedValue(json(TOKENS));
    const { GET } = await import('./callback/route');
    const res = await GET(callback('ticket=t-1&returnTo=%2F%2Fevil.example%2Fx'));
    expect(new URL(res.headers.get('location')!).host).toBe('acme.proctira.io');
  });

  it('a missing ticket never calls the gateway', async () => {
    const { GET } = await import('./callback/route');
    const res = await GET(callback('returnTo=%2F'));
    expect(new URL(res.headers.get('location')!).searchParams.get('error')).toBe('missing_ticket');
    expect(fetchMock).not.toHaveBeenCalled();
  });
});

describe('POST /api/auth/mfa/verify against the gateway contract (PRC-M133)', () => {
  function verify(body: unknown, cookie?: string): Request {
    return new Request('https://acme.proctira.io/api/auth/mfa/verify', {
      method: 'POST',
      headers: {
        host: 'acme.proctira.io',
        'content-type': 'application/json',
        ...(cookie ? { cookie } : {}),
      },
      body: JSON.stringify(body),
    });
  }

  it('sends the httpOnly challenge and code, stores tokens and clears the challenge', async () => {
    fetchMock.mockResolvedValue(
      json({
        success: true,
        method: 'sms',
        tokens: TOKENS,
        session: { id: 'sess-2', expiresAt: '2026-10-29T00:00:00.000Z' },
      }),
    );
    const { POST } = await import('./mfa/verify/route');
    const res = await POST(verify({ code: '123456' }, `${AUTH_COOKIES.MFA_CHALLENGE}=mfa-tok`));
    expect(res.status).toBe(200);
    const [url, init] = fetchMock.mock.calls[0]!;
    expect(String(url)).toBe('http://gateway.internal/auth/mfa/verify');
    expect(new Headers(init?.headers).get('X-Tenant-ID')).toBe('acme');
    expect(JSON.parse(String(init?.body))).toEqual({ mfaToken: 'mfa-tok', code: '123456' });
    expect(cookieValue(res, AUTH_COOKIES.ACCESS_TOKEN)).toBe('at-1');
    expect(cookieValue(res, AUTH_COOKIES.SESSION_ID)).toBe('sess-2');
    expect(cookieValue(res, AUTH_COOKIES.MFA_CHALLENGE)).toBe('');
  });

  it('passes a wrong-code 401 through and sets no session cookie', async () => {
    fetchMock.mockResolvedValue(
      json({ code: 'OTP_INVALID', message: 'Invalid code', statusCode: 401 }, 401),
    );
    const { POST } = await import('./mfa/verify/route');
    const res = await POST(verify({ code: '000000' }, `${AUTH_COOKIES.MFA_CHALLENGE}=mfa-tok`));
    expect(res.status).toBe(401);
    expect(cookieValue(res, AUTH_COOKIES.ACCESS_TOKEN)).toBeUndefined();
  });

  it('treats a 200 without tokens (completion-ticket path) as a gateway error', async () => {
    fetchMock.mockResolvedValue(json({ success: true, method: 'sms', completionTicket: 'ct-1' }));
    const { POST } = await import('./mfa/verify/route');
    const res = await POST(verify({ code: '123456' }, `${AUTH_COOKIES.MFA_CHALLENGE}=mfa-tok`));
    expect(res.status).toBe(502);
    expect(cookieValue(res, AUTH_COOKIES.ACCESS_TOKEN)).toBeUndefined();
  });

  it('returns 401 without calling the gateway when there is no challenge', async () => {
    const { POST } = await import('./mfa/verify/route');
    expect((await POST(verify({ code: '123456' }))).status).toBe(401);
    expect(fetchMock).not.toHaveBeenCalled();
  });
});
