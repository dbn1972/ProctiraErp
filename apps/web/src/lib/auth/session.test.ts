import { describe, it, expect } from 'vitest';

import {
  AUTH_COOKIES,
  AUTH_ENDPOINTS,
  OAUTH_PROVIDERS,
  decodeTokenPayload,
  getOAuthAuthorizeUrl,
  isTokenExpired,
} from './session';

/**
 * Helper to mint a fake JWT for tests. We don't sign it cryptographically
 * since the client utilities only ever read the payload claims.
 */
function makeJwt(payload: Record<string, unknown>): string {
  const header = btoa(JSON.stringify({ alg: 'HS256', typ: 'JWT' }));
  const body = btoa(JSON.stringify(payload));
  const signature = btoa('signature');
  return `${header}.${body}.${signature}`;
}

describe('AUTH_COOKIES / AUTH_ENDPOINTS', () => {
  it('exposes stable cookie names', () => {
    expect(AUTH_COOKIES.ACCESS_TOKEN).toBe('access_token');
    expect(AUTH_COOKIES.REFRESH_TOKEN).toBe('refresh_token');
    expect(AUTH_COOKIES.SESSION_ID).toBe('session_id');
  });

  it('exposes the API route endpoints', () => {
    expect(AUTH_ENDPOINTS.LOGIN).toBe('/api/auth/login');
    expect(AUTH_ENDPOINTS.LOGOUT).toBe('/api/auth/logout');
    expect(AUTH_ENDPOINTS.REFRESH).toBe('/api/auth/refresh');
    expect(AUTH_ENDPOINTS.SESSION).toBe('/api/auth/session');
    expect(AUTH_ENDPOINTS.KEYCLOAK).toBe('/api/auth/keycloak');
    expect(AUTH_ENDPOINTS.OAUTH_CALLBACK).toBe('/api/auth/oauth/callback');
  });
});

describe('OAUTH_PROVIDERS', () => {
  it('lists the configured providers in stable order', () => {
    expect(OAUTH_PROVIDERS.map((p) => p.id)).toEqual(['microsoft', 'google']);
  });
});

describe('decodeTokenPayload', () => {
  it('returns the parsed payload for a well-formed JWT', () => {
    const token = makeJwt({
      sub: 'user-1',
      tenantId: 't-1',
      email: 'a@b.c',
      roles: [],
      iat: 1,
      exp: 2,
    });
    const payload = decodeTokenPayload(token);
    expect(payload?.sub).toBe('user-1');
    expect(payload?.tenantId).toBe('t-1');
    expect(payload?.email).toBe('a@b.c');
  });

  it('returns null for malformed tokens', () => {
    expect(decodeTokenPayload('')).toBeNull();
    expect(decodeTokenPayload('not.a.jwt.at.all')).toBeNull();
    expect(decodeTokenPayload('only-one-part')).toBeNull();
    expect(decodeTokenPayload('header.!!!.signature')).toBeNull();
  });
});

describe('isTokenExpired', () => {
  it('returns true for an already-expired token', () => {
    const token = makeJwt({ exp: Math.floor(Date.now() / 1000) - 60 });
    expect(isTokenExpired(token)).toBe(true);
  });

  it('returns true within the 30s expiry buffer', () => {
    const token = makeJwt({ exp: Math.floor(Date.now() / 1000) + 10 });
    expect(isTokenExpired(token)).toBe(true);
  });

  it('returns false for a fresh token', () => {
    const token = makeJwt({ exp: Math.floor(Date.now() / 1000) + 600 });
    expect(isTokenExpired(token)).toBe(false);
  });

  it('returns true for malformed tokens', () => {
    expect(isTokenExpired('garbage')).toBe(true);
    expect(isTokenExpired('')).toBe(true);
  });
});

describe('getOAuthAuthorizeUrl', () => {
  it('builds an authorize URL with provider', () => {
    expect(getOAuthAuthorizeUrl('google')).toBe('/api/auth/oauth/authorize?provider=google');
  });

  it('includes returnTo when provided', () => {
    expect(getOAuthAuthorizeUrl('microsoft', '/students')).toBe(
      '/api/auth/oauth/authorize?provider=microsoft&returnTo=%2Fstudents',
    );
  });
});
