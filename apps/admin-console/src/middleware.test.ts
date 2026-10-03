/**
 * PRC-M005: middleware regression tests with real JWT-shaped samples (base64url, exp claims).
 */
import { NextRequest } from 'next/server';
import { describe, expect, it } from 'vitest';

import { ADMIN_AUTH_COOKIES } from './lib/auth/cookies';
import { middleware } from './middleware';

function b64url(value: unknown): string {
  return Buffer.from(JSON.stringify(value)).toString('base64url');
}

function jwt(payload: Record<string, unknown>): string {
  return `${b64url({ alg: 'RS256', typ: 'JWT' })}.${b64url(payload)}.c2lnbmF0dXJl`;
}

const now = () => Math.floor(Date.now() / 1000);

function request(path: string, token?: string): NextRequest {
  const req = new NextRequest(`https://admin.example${path}`);
  if (token) req.cookies.set(ADMIN_AUTH_COOKIES.ACCESS_TOKEN, token);
  return req;
}

function loginRedirect(res: Response): URL | null {
  const location = res.headers.get('location');
  return location ? new URL(location) : null;
}

describe('admin console middleware', () => {
  it('redirects to /login with a sanitised returnTo when no cookie is present', () => {
    const url = loginRedirect(middleware(request('/tenants/tnt_001')));
    expect(url?.pathname).toBe('/login');
    expect(url?.searchParams.get('returnTo')).toBe('/tenants/tnt_001');
  });

  it('lets a fresh token through (with a non-ASCII base64url claim)', () => {
    const token = jwt({ sub: 'op-1', name: 'Zoë Ødegård', exp: now() + 600 });
    const res = middleware(request('/tenants', token));
    expect(res.headers.get('location')).toBeNull();
  });

  it('treats a token inside the 30 s expiry buffer as expired', () => {
    const res = middleware(request('/tenants', jwt({ sub: 'op-1', exp: now() + 10 })));
    expect(loginRedirect(res)?.pathname).toBe('/login');
  });

  it('rejects an expired token', () => {
    const res = middleware(request('/plugins', jwt({ sub: 'op-1', exp: now() - 60 })));
    expect(loginRedirect(res)?.pathname).toBe('/login');
  });

  it.each(['not-a-jwt', 'a.b', 'x.!!!.y', ''])('rejects malformed token %j', (token) => {
    const res = middleware(request('/plans', token || undefined));
    expect(loginRedirect(res)?.pathname).toBe('/login');
  });

  it('does not reflect an open-redirect returnTo', () => {
    const url = loginRedirect(middleware(request('//evil/x')));
    expect(url?.host).toBe('admin.example');
    expect(url?.searchParams.get('returnTo')?.startsWith('//')).toBeFalsy();
  });

  it('serves public paths without a session', () => {
    expect(middleware(request('/login')).headers.get('location')).toBeNull();
    expect(middleware(request('/forbidden')).headers.get('location')).toBeNull();
  });
});
