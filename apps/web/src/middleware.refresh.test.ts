/**
 * PRC-M493: transparent refresh is single-flight per refresh token and never
 * loops when the refresh response carries no rotated cookies.
 */
import { NextRequest } from 'next/server';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { __resetRefreshSingleFlight, clearTenantConfigCache, middleware } from './middleware';
function jwt(payload: Record<string, unknown>): string {
  const enc = (o: unknown) => Buffer.from(JSON.stringify(o)).toString('base64url');
  return `${enc({ alg: 'HS256', typ: 'JWT' })}.${enc(payload)}.sig`;
}
const expired = jwt({ sub: 'u1', tenantId: 't1', exp: Math.floor(Date.now() / 1000) - 60 });
function navigation(): NextRequest {
  return new NextRequest('https://app.proctira.io/dashboard', {
    headers: {
      host: 'app.proctira.io',
      cookie: `access_token=${expired}; refresh_token=rt-1`,
    },
  });
}
const fetchMock = vi.fn<(input: RequestInfo | URL, init?: RequestInit) => Promise<Response>>();
const refreshCalls = () =>
  fetchMock.mock.calls.filter(([url]) => String(url).includes('/api/auth/refresh')).length;
beforeEach(() => {
  __resetRefreshSingleFlight();
  clearTenantConfigCache();
  fetchMock.mockReset();
  vi.stubGlobal('fetch', fetchMock);
});
afterEach(() => {
  vi.unstubAllGlobals();
});
function deletesSession(res: Response): boolean {
  const cookies = (res.headers as Headers & { getSetCookie(): string[] }).getSetCookie();
  return cookies.some(
    (c) =>
      /^(access_token|refresh_token)=;/.test(c) || /Max-Age=0|Expires=Thu, 01 Jan 1970/i.test(c),
  );
}
describe('middleware refresh single-flight (PRC-M493)', () => {
  it('5 parallel requests with an expired token make exactly one refresh call and keep the session', async () => {
    fetchMock.mockImplementation(async (url) => {
      if (String(url).includes('/api/auth/refresh')) {
        await new Promise((r) => setTimeout(r, 10));
        const headers = new Headers();
        headers.append('set-cookie', 'access_token=new-at; Path=/; HttpOnly');
        headers.append('set-cookie', 'refresh_token=rt-2; Path=/; HttpOnly');
        return new Response('{}', { status: 200, headers });
      }
      return new Response('{}', { status: 404 });
    });
    const responses = await Promise.all(Array.from({ length: 5 }, () => middleware(navigation())));
    expect(refreshCalls()).toBe(1);
    for (const res of responses) {
      expect(res.status).toBe(307);
      expect(res.headers.get('location')).toBe('https://app.proctira.io/dashboard');
      expect(deletesSession(res)).toBe(false);
      const cookies = (res.headers as Headers & { getSetCookie(): string[] }).getSetCookie();
      expect(cookies.some((c) => c.startsWith('refresh_token=rt-2'))).toBe(true);
    }
  });
  it('a 200 refresh without Set-Cookie redirects to login instead of replaying (no loop)', async () => {
    fetchMock.mockImplementation(async (url) =>
      String(url).includes('/api/auth/refresh')
        ? new Response('{}', { status: 200 })
        : new Response('{}', { status: 404 }),
    );
    const res = await middleware(navigation());
    expect(res.status).toBe(307);
    expect(new URL(res.headers.get('location')!).pathname).toBe('/login');
  });
});
