// @vitest-environment node
import { afterEach, describe, expect, it, vi } from 'vitest';

import { POST } from '../app/track/lookup/route';
import {
  buildTrackDobCookie,
  isSecureTrackContext,
  trackLookupLocation,
  TRACK_DOB_COOKIE,
} from './track-lookup';

const headers = (h: Record<string, string>) => ({
  get: (name: string) => h[name.toLowerCase()] ?? null,
});

function lookupRequest(
  url: string,
  fields: Record<string, string>,
  extraHeaders: Record<string, string> = {},
): Request {
  return new Request(url, {
    method: 'POST',
    body: new URLSearchParams(fields),
    headers: { 'content-type': 'application/x-www-form-urlencoded', ...extraHeaders },
  });
}

describe('UATENV-D31 / PRC-L225: POST /track/lookup in production without a configured base', () => {
  afterEach(() => {
    vi.unstubAllEnvs();
  });

  function stubProduction() {
    vi.stubEnv('NODE_ENV', 'production');
    vi.stubEnv('PUBLIC_BASE_URL', '');
    vi.stubEnv('PUBLIC_URL', '');
  }

  it('redirects to the status page instead of answering 500', async () => {
    stubProduction();
    const response = await POST(
      lookupRequest('http://0.0.0.0:3002/track/lookup', {
        trackingNumber: 'reg-a1b2c3d4',
        dob: '2018-04-12',
      }),
    );
    expect(response.status).toBe(303);
    expect(response.headers.get('location')).toBe('/track/REG-A1B2C3D4');
  });

  it('keeps every tenant host: the Location is host-relative, so the browser stays on the host it used', async () => {
    stubProduction();
    for (const host of ['register.proctira-uat.localhost', 'e2e-registration.proctira.localhost']) {
      const response = await POST(
        lookupRequest(
          `http://${host}:29080/track/lookup`,
          { trackingNumber: 'REG-A1B2C3D4', dob: '2018-04-12' },
          { host },
        ),
      );
      const location = response.headers.get('location') ?? '';
      expect(location).toBe('/track/REG-A1B2C3D4');
      expect(location).not.toMatch(/^[a-z][a-z0-9+.-]*:|^\/\//i);
    }
  });

  it('never puts a forged X-Forwarded-Host (or the internal origin) into Location', async () => {
    stubProduction();
    const response = await POST(
      lookupRequest(
        'http://0.0.0.0:3002/track/lookup',
        { trackingNumber: 'REG-A1B2C3D4', dob: '2018-04-12' },
        { 'x-forwarded-host': 'attacker.example', 'x-forwarded-proto': 'https' },
      ),
    );
    const location = response.headers.get('location') ?? '';
    expect(location).toBe('/track/REG-A1B2C3D4');
    expect(location).not.toContain('attacker.example');
    expect(location).not.toContain('0.0.0.0');
  });

  it('ignores a configured PUBLIC_BASE_URL, so one fixed host cannot capture other tenants', async () => {
    vi.stubEnv('NODE_ENV', 'production');
    vi.stubEnv('PUBLIC_BASE_URL', 'https://portal.example');
    const response = await POST(
      lookupRequest('http://0.0.0.0:3002/track/lookup', {
        trackingNumber: 'REG-A1B2C3D4',
        dob: '2018-04-12',
      }),
    );
    expect(response.headers.get('location')).toBe('/track/REG-A1B2C3D4');
  });

  it('sets the host-only __Host- DOB cookie (Secure, Path=/, no Domain) in production', async () => {
    stubProduction();
    const response = await POST(
      lookupRequest('http://0.0.0.0:3002/track/lookup', {
        trackingNumber: 'REG-A1B2C3D4',
        dob: '2018-04-12',
      }),
    );
    const setCookie = response.headers.get('set-cookie') ?? '';
    expect(setCookie).toMatch(/^__Host-registration_track_dob=2018-04-12/);
    expect(setCookie).toMatch(/;\s*Secure/i);
    expect(setCookie).toMatch(/;\s*Path=\//i);
    expect(setCookie).toMatch(/;\s*HttpOnly/i);
    expect(setCookie).not.toMatch(/Domain=/i);
  });

  it('sends an invalid lookup back to the form with a relative Location and no cookie', async () => {
    stubProduction();
    const response = await POST(
      lookupRequest(
        'http://0.0.0.0:3002/track/lookup',
        { trackingNumber: 'REG-A1B2C3D4', dob: '2018-02-31' },
        { 'x-forwarded-host': 'attacker.example' },
      ),
    );
    expect(response.status).toBe(303);
    expect(response.headers.get('location')).toBe('/track?error=invalid');
    expect(response.headers.get('set-cookie')).toBeNull();
  });
});

describe('PRC-L225: host-relative Location', () => {
  it('builds the status path from a validated tracking number only', () => {
    expect(
      trackLookupLocation({ ok: true, trackingNumber: 'REG-A1B2C3D4', dob: '2018-04-12' }),
    ).toBe('/track/REG-A1B2C3D4');
    expect(trackLookupLocation({ ok: false })).toBe('/track?error=invalid');
  });
});

describe('PRC-L225: secure context for the DOB cookie', () => {
  it('is always secure in production, whatever the headers say', () => {
    expect(
      isSecureTrackContext(
        'http://0.0.0.0:3002/track/lookup',
        headers({ 'x-forwarded-proto': 'http' }),
        {
          NODE_ENV: 'production',
        },
      ),
    ).toBe(true);
  });

  it('is secure for an https request or an https forwarded proto outside production', () => {
    expect(
      isSecureTrackContext('https://localhost:3002/x', headers({}), { NODE_ENV: 'development' }),
    ).toBe(true);
    expect(
      isSecureTrackContext('http://localhost:3002/x', headers({ 'x-forwarded-proto': 'https' }), {
        NODE_ENV: 'development',
      }),
    ).toBe(true);
  });

  it('is insecure for plain http local dev', () => {
    expect(
      isSecureTrackContext('http://localhost:3002/x', headers({}), { NODE_ENV: 'development' }),
    ).toBe(false);
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
