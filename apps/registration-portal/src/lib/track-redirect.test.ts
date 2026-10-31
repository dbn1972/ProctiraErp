import { describe, expect, it } from 'vitest';

import { buildTrackDobCookie, resolveRedirectBase, TRACK_DOB_COOKIE } from './track-lookup';

const headers = (h: Record<string, string>) => ({
  get: (name: string) => h[name.toLowerCase()] ?? null,
});

describe('PRC-L225: trusted-base Location in a deployed environment', () => {
  it('uses the configured PUBLIC_BASE_URL even when a spoofed X-Forwarded-Host is present', () => {
    const base = resolveRedirectBase(
      'http://0.0.0.0:3002/track/lookup',
      headers({ 'x-forwarded-host': 'attacker.example', 'x-forwarded-proto': 'https' }),
      { PUBLIC_BASE_URL: 'https://portal.example', NODE_ENV: 'production' },
    );
    expect(base.origin).toBe('https://portal.example');
  });

  it('accepts PUBLIC_URL as an alias for the trusted base', () => {
    const base = resolveRedirectBase('http://0.0.0.0:3002/x', headers({}), {
      PUBLIC_URL: 'https://apply.school.example',
      NODE_ENV: 'production',
    });
    expect(base.origin).toBe('https://apply.school.example');
  });

  it('never derives Location from a forgeable Host header in a deployed env with no trusted base', () => {
    expect(() =>
      resolveRedirectBase(
        'http://0.0.0.0:3002/track/lookup',
        headers({ 'x-forwarded-host': 'attacker.example', 'x-forwarded-proto': 'https' }),
        { NODE_ENV: 'production' },
      ),
    ).toThrow(/trusted public base/i);
  });

  it('still falls back to the request URL for local/dev', () => {
    const base = resolveRedirectBase('http://localhost:3002/track/lookup', headers({}), {
      NODE_ENV: 'development',
    });
    expect(base.origin).toBe('http://localhost:3002');
  });
});

describe('PRC-L225: __Host- DOB cookie', () => {
  it('uses the __Host- prefix, Secure, Path=/ and no Domain in a secure context', () => {
    const cookie = buildTrackDobCookie('2015-03-02', { secure: true });
    expect(cookie.name).toBe('__Host-registration_track_dob');
    expect(cookie.name.startsWith('__Host-')).toBe(true);
    expect(cookie.options.secure).toBe(true);
    expect(cookie.options.path).toBe('/');
    expect('domain' in cookie.options).toBe(false);
    expect(cookie.options.httpOnly).toBe(true);
    expect(cookie.options.sameSite).toBe('lax');
    expect(cookie.value).toBe('2015-03-02');
  });

  it('falls back to the unprefixed name for an insecure local-dev context', () => {
    const cookie = buildTrackDobCookie('2015-03-02', { secure: false });
    expect(cookie.name).toBe(TRACK_DOB_COOKIE);
    expect(cookie.options.secure).toBe(false);
    expect(cookie.options.path).toBe('/');
  });
});
