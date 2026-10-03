/**
 * PRC-H043: ROPC policy (disabled in production by default) and second-factor forwarding.
 */
import Fastify from 'fastify';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { readOneTimeCode, readPasswordGrantMode } from './password-grant-policy.js';
import { registerKeycloakAuthRoutes } from './routes.js';

const base = {
  issuer: 'http://localhost:8180/realms/proctira',
  clientId: 'proctira-gateway',
  realm: 'proctira',
  jwksUri: 'http://localhost:8180/realms/proctira/protocol/openid-connect/certs',
  redirectUri: 'http://localhost:3200/api/v1/auth/callback',
};
const credentials = { username: 'user@example.test', password: 'example-password' };

function tokenResponse() {
  const seg = (o: object) => Buffer.from(JSON.stringify(o)).toString('base64url');
  return new Response(
    JSON.stringify({
      access_token: `${seg({ alg: 'RS256' })}.${seg({ sub: 'kc-user' })}.sig`,
      refresh_token: 'refresh-1',
      token_type: 'Bearer',
      expires_in: 300,
    }),
    { status: 200, headers: { 'content-type': 'application/json' } },
  );
}

describe('PRC-H043 password grant policy', () => {
  afterEach(() => vi.restoreAllMocks());

  it('defaults to disabled in production and enabled elsewhere; rejects unknown values', () => {
    expect(readPasswordGrantMode({ NODE_ENV: 'production' })).toBe('disabled');
    expect(readPasswordGrantMode({ NODE_ENV: 'development' })).toBe('enabled');
    expect(
      readPasswordGrantMode({ NODE_ENV: 'production', AUTH_PASSWORD_GRANT: 'enabled' }),
    ).toBe('enabled');
    expect(() => readPasswordGrantMode({ AUTH_PASSWORD_GRANT: 'maybe' })).toThrow();
  });

  it('accepts only 6-8 digit one-time codes', () => {
    expect(readOneTimeCode({})).toEqual({ invalid: false });
    expect(readOneTimeCode({ otp: '123456' })).toEqual({ code: '123456', invalid: false });
    expect(readOneTimeCode({ totp: '12a456' }).invalid).toBe(true);
  });

  it('disabled grant answers 403 and never contacts Keycloak', async () => {
    const fetchMock = vi.spyOn(globalThis, 'fetch');
    const app = Fastify();
    await registerKeycloakAuthRoutes(app, { ...base, passwordGrant: 'disabled' });
    const res = await app.inject({
      method: 'POST',
      url: '/api/v1/auth/password',
      payload: credentials,
    });
    expect(res.statusCode).toBe(403);
    expect(res.json().code).toBe('PASSWORD_GRANT_DISABLED');
    expect(fetchMock).not.toHaveBeenCalled();
    await app.close();
  });

  it('forwards the second factor as totp to the Keycloak direct grant', async () => {
    const fetchMock = vi.spyOn(globalThis, 'fetch').mockResolvedValue(tokenResponse());
    const app = Fastify();
    await registerKeycloakAuthRoutes(app, { ...base, passwordGrant: 'enabled' });
    const res = await app.inject({
      method: 'POST',
      url: '/api/v1/auth/password',
      payload: { ...credentials, otp: '654321' },
    });
    expect(res.statusCode).toBe(200);
    const sent = new URLSearchParams(String(fetchMock.mock.calls[0]?.[1]?.body ?? ''));
    expect(sent.get('totp')).toBe('654321');
    await app.close();
  });

  it('a user with OTP configured gets no tokens without the second factor', async () => {
    // Keycloak direct-grant conditional OTP rejects the grant when `totp` is missing.
    vi.spyOn(globalThis, 'fetch').mockResolvedValue(
      new Response(JSON.stringify({ error: 'invalid_grant', error_description: 'Invalid user credentials' }), {
        status: 401,
        headers: { 'content-type': 'application/json' },
      }),
    );
    const app = Fastify();
    await registerKeycloakAuthRoutes(app, { ...base, passwordGrant: 'enabled' });
    const res = await app.inject({
      method: 'POST',
      url: '/api/v1/auth/password',
      payload: credentials,
    });
    expect(res.statusCode).toBe(401);
    expect(res.json().accessToken).toBeUndefined();
    await app.close();
  });

  it('malformed otp is a 400 before Keycloak is called', async () => {
    const fetchMock = vi.spyOn(globalThis, 'fetch');
    const app = Fastify();
    await registerKeycloakAuthRoutes(app, base);
    const res = await app.inject({
      method: 'POST',
      url: '/api/v1/auth/password',
      payload: { ...credentials, otp: 'abc' },
    });
    expect(res.statusCode).toBe(400);
    expect(fetchMock).not.toHaveBeenCalled();
    await app.close();
  });
});
