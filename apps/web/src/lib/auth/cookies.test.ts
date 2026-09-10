import { afterEach, describe, expect, it, vi } from 'vitest';
import {
  accessTokenCookieOptions,
  clearCookieOptions,
  isSecureCookieContext,
  refreshTokenCookieOptions,
} from './cookies';

/**
 * G-719: the `Secure` attribute must follow the transport, not only NODE_ENV.
 * NODE_ENV is `test` under vitest so the production short-circuit is off.
 */
describe('cookies — Secure flag resolution (G-719)', () => {
  afterEach(() => {
    vi.unstubAllEnvs();
  });

  it('is false for plain-http development requests with no overrides', () => {
    vi.stubEnv('COOKIE_SECURE', '');
    vi.stubEnv('NEXT_PUBLIC_APP_URL', '');
    vi.stubEnv('APP_URL', '');
    const req = new Request('http://localhost:3001/api/auth/login', { method: 'POST' });
    expect(isSecureCookieContext(req)).toBe(false);
    expect(accessTokenCookieOptions(900, req).secure).toBe(false);
  });

  it('is true when the request URL itself is https', () => {
    vi.stubEnv('COOKIE_SECURE', '');
    vi.stubEnv('NEXT_PUBLIC_APP_URL', '');
    vi.stubEnv('APP_URL', '');
    const req = new Request('https://app.proctira.io/api/auth/login', { method: 'POST' });
    expect(isSecureCookieContext(req)).toBe(true);
  });

  it('is true behind a TLS-terminating proxy (x-forwarded-proto: https)', () => {
    vi.stubEnv('COOKIE_SECURE', '');
    vi.stubEnv('NEXT_PUBLIC_APP_URL', '');
    vi.stubEnv('APP_URL', '');
    const req = new Request('http://10.0.0.5:3001/api/auth/login', {
      method: 'POST',
      headers: { 'x-forwarded-proto': 'https, http' },
    });
    expect(refreshTokenCookieOptions(undefined, req).secure).toBe(true);
    expect(clearCookieOptions(req).secure).toBe(true);
  });

  it('is false when the proxy reports plain http even if URL is https-looking', () => {
    vi.stubEnv('COOKIE_SECURE', '');
    vi.stubEnv('NEXT_PUBLIC_APP_URL', '');
    vi.stubEnv('APP_URL', '');
    const req = new Request('https://app.proctira.io/api/auth/login', {
      method: 'POST',
      headers: { 'x-forwarded-proto': 'http' },
    });
    expect(isSecureCookieContext(req)).toBe(false);
  });

  it('honours the COOKIE_SECURE override and an https public app URL', () => {
    vi.stubEnv('COOKIE_SECURE', '1');
    expect(isSecureCookieContext(null)).toBe(true);
    vi.stubEnv('COOKIE_SECURE', '');
    vi.stubEnv('NEXT_PUBLIC_APP_URL', 'https://school.proctira.io');
    expect(isSecureCookieContext(undefined)).toBe(true);
  });

  it('keeps every auth cookie httpOnly + lax + path=/', () => {
    for (const opts of [
      accessTokenCookieOptions(),
      refreshTokenCookieOptions(),
      clearCookieOptions(),
    ]) {
      expect(opts.httpOnly).toBe(true);
      expect(opts.sameSite).toBe('lax');
      expect(opts.path).toBe('/');
    }
    expect(clearCookieOptions().maxAge).toBe(0);
  });
});
