/**
 * @vitest-environment node
 *
 * PRC-H019 — MFA enrolment hands off to Keycloak's CONFIGURE_TOTP action via
 * the gateway PKCE login; signed-out callers sign in first.
 */
import { NextRequest } from 'next/server';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { GET } from './route';

function req(cookie?: string): NextRequest {
  const r = new NextRequest('http://localhost:3001/api/auth/mfa/enrol');
  if (cookie) r.cookies.set('access_token', cookie);
  return r;
}

afterEach(() => {
  vi.unstubAllEnvs();
});

describe('GET /api/auth/mfa/enrol', () => {
  it('redirects a signed-in user to the gateway login with kc_action=CONFIGURE_TOTP', () => {
    vi.stubEnv('GATEWAY_URL', 'http://gateway.test:3000');
    const res = GET(req('tok'));
    expect(res.status).toBe(307);
    const location = new URL(res.headers.get('location')!);
    expect(location.origin).toBe('http://gateway.test:3000');
    expect(location.pathname).toBe('/api/v1/auth/login');
    expect(location.searchParams.get('kc_action')).toBe('CONFIGURE_TOTP');
    expect(location.searchParams.get('state')).toBe('web:/dashboard');
  });

  it('sends a signed-out caller to sign in first', () => {
    const res = GET(req());
    const location = new URL(res.headers.get('location')!);
    expect(location.pathname).toBe('/login');
    expect(location.searchParams.get('returnTo')).toBe('/mfa-setup');
  });

  it('is not served when a native auth service owns enrolment', () => {
    vi.stubEnv('MFA_ENROLMENT_PROVIDER', 'auth-service');
    expect(GET(req('tok')).status).toBe(404);
  });
});
