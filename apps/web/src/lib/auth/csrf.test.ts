import { describe, expect, it } from 'vitest';
import {
  CSRF_COOKIE,
  CSRF_HEADER,
  generateCsrfToken,
  isUnsafeMethod,
  parseCookieHeader,
  verifyCsrf,
  verifyDoubleSubmit,
  verifyRequestOrigin,
} from './csrf';

const ORIGIN = 'https://app.proctira.io';

function makeRequest(init: {
  method?: string;
  headers?: Record<string, string>;
  url?: string;
}): Request {
  return new Request(init.url ?? `${ORIGIN}/api/auth/login`, {
    method: init.method ?? 'POST',
    headers: { host: 'app.proctira.io', ...init.headers },
  });
}

describe('csrf — token + parsing', () => {
  it('generates 64-hex-char unique tokens', () => {
    const a = generateCsrfToken();
    const b = generateCsrfToken();
    expect(a).toMatch(/^[0-9a-f]{64}$/);
    expect(a).not.toBe(b);
  });

  it('parses cookie headers, first value wins, decodes values', () => {
    const jar = parseCookieHeader('a=1; b=hello%20world; a=2; =bad; novalue');
    expect(jar.get('a')).toBe('1');
    expect(jar.get('b')).toBe('hello world');
    expect(jar.has('novalue')).toBe(false);
    expect(parseCookieHeader(null).size).toBe(0);
  });

  it('classifies unsafe methods', () => {
    expect(isUnsafeMethod('GET')).toBe(false);
    expect(isUnsafeMethod('HEAD')).toBe(false);
    expect(isUnsafeMethod('OPTIONS')).toBe(false);
    expect(isUnsafeMethod('post')).toBe(true);
    expect(isUnsafeMethod('DELETE')).toBe(true);
    expect(isUnsafeMethod(undefined)).toBe(false);
  });
});

describe('csrf — origin verification', () => {
  it('rejects Sec-Fetch-Site: cross-site', () => {
    const req = makeRequest({ headers: { 'sec-fetch-site': 'cross-site' } });
    expect(verifyRequestOrigin(req)).toEqual({ ok: false, reason: 'cross-site' });
  });

  it('accepts same-origin / same-site / none fetch metadata', () => {
    for (const site of ['same-origin', 'same-site', 'none']) {
      expect(verifyRequestOrigin(makeRequest({ headers: { 'sec-fetch-site': site } })).ok).toBe(
        true,
      );
    }
  });

  it('rejects an Origin header that does not match the host', () => {
    const req = makeRequest({ headers: { origin: 'https://evil.example' } });
    expect(verifyRequestOrigin(req)).toEqual({ ok: false, reason: 'origin-mismatch' });
  });

  it('accepts a matching Origin header, case-insensitively', () => {
    expect(
      verifyRequestOrigin(makeRequest({ headers: { origin: 'https://APP.proctira.io' } })).ok,
    ).toBe(true);
  });

  it('honours x-forwarded-host behind a proxy', () => {
    const req = makeRequest({
      url: 'http://10.0.0.5:3001/api/auth/login',
      headers: { host: '10.0.0.5:3001', 'x-forwarded-host': 'app.proctira.io', origin: ORIGIN },
    });
    expect(verifyRequestOrigin(req).ok).toBe(true);
  });

  it('falls back to Referer when Origin is absent', () => {
    expect(
      verifyRequestOrigin(makeRequest({ headers: { referer: 'https://evil.example/page' } })),
    ).toEqual({ ok: false, reason: 'origin-mismatch' });
    expect(verifyRequestOrigin(makeRequest({ headers: { referer: `${ORIGIN}/login` } })).ok).toBe(
      true,
    );
  });

  it('passes when neither Origin nor Referer is present (server-to-server)', () => {
    expect(verifyRequestOrigin(makeRequest({})).ok).toBe(true);
  });
});

describe('csrf — double submit', () => {
  const token = generateCsrfToken();

  it('requires the cookie', () => {
    expect(verifyDoubleSubmit(makeRequest({ headers: { [CSRF_HEADER]: token } }))).toEqual({
      ok: false,
      reason: 'missing-cookie',
    });
  });

  it('requires the header', () => {
    expect(
      verifyDoubleSubmit(makeRequest({ headers: { cookie: `${CSRF_COOKIE}=${token}` } })),
    ).toEqual({
      ok: false,
      reason: 'missing-header',
    });
  });

  it('rejects mismatched tokens', () => {
    const req = makeRequest({
      headers: { cookie: `${CSRF_COOKIE}=${token}`, [CSRF_HEADER]: generateCsrfToken() },
    });
    expect(verifyDoubleSubmit(req)).toEqual({ ok: false, reason: 'token-mismatch' });
  });

  it('accepts matching tokens', () => {
    const req = makeRequest({
      headers: { cookie: `access_token=abc; ${CSRF_COOKIE}=${token}`, [CSRF_HEADER]: token },
    });
    expect(verifyDoubleSubmit(req)).toEqual({ ok: true });
  });
});

describe('csrf — verifyCsrf', () => {
  it('always passes safe methods', () => {
    expect(
      verifyCsrf(makeRequest({ method: 'GET', headers: { origin: 'https://evil.example' } })),
    ).toEqual({
      ok: true,
    });
  });

  it('applies origin check before the token check', () => {
    const token = generateCsrfToken();
    const req = makeRequest({
      headers: {
        origin: 'https://evil.example',
        cookie: `${CSRF_COOKIE}=${token}`,
        [CSRF_HEADER]: token,
      },
    });
    expect(verifyCsrf(req)).toEqual({ ok: false, reason: 'origin-mismatch' });
  });

  it('accepts a well-formed same-origin mutating request', () => {
    const token = generateCsrfToken();
    const req = makeRequest({
      headers: {
        origin: ORIGIN,
        'sec-fetch-site': 'same-origin',
        cookie: `${CSRF_COOKIE}=${token}`,
        [CSRF_HEADER]: token,
      },
    });
    expect(verifyCsrf(req)).toEqual({ ok: true });
  });
});
