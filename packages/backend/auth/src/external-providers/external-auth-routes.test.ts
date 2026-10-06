/**
 * PRC-M589 — external-auth routes bind state to the browser via an httpOnly
 * cookie and deliver tokens through a one-time ticket, never the URL.
 */
import Fastify, { type FastifyInstance, type FastifyRequest } from 'fastify';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { ExternalAuthHandler } from './external-auth-handler.js';
import { registerExternalAuthRoutes } from './external-auth-routes.js';

const result = {
  tokens: {
    accessToken: 'AT-secret',
    refreshToken: 'RT-secret',
    expiresIn: 900,
    tokenType: 'Bearer',
  },
  session: { id: 's1', expiresAt: new Date(Date.now() + 3600_000).toISOString() },
  user: { userId: 'u1' },
  isNewUser: false,
  providerId: 'google',
};

describe('PRC-M589 external auth routes', () => {
  let app: FastifyInstance;
  let handleCallback: ReturnType<typeof vi.fn>;

  beforeEach(async () => {
    handleCallback = vi.fn(async () => result);
    const handler = {
      listProviders: () => [],
      initiateAuth: vi.fn(async () => ({ redirectUrl: 'https://idp/auth', state: 'state-abc' })),
      handleCallback,
    } as unknown as ExternalAuthHandler;
    app = Fastify();
    app.addHook('onRequest', async (req: FastifyRequest) => {
      (req as FastifyRequest & { tenantId?: string }).tenantId = 'tenant-1';
    });
    await registerExternalAuthRoutes(app, {
      handler,
      successRedirectUrl: 'https://app.example.com/sso/done',
    });
    await app.ready();
  });
  afterEach(async () => {
    await app.close();
  });

  async function login() {
    const res = await app.inject({ method: 'GET', url: '/auth/external/google/login' });
    expect(res.statusCode).toBe(302);
    const setCookie = String(res.headers['set-cookie']);
    expect(setCookie).toMatch(/ext_auth_state=state-abc; .*HttpOnly; Secure; SameSite=None/);
    return setCookie.split(';')[0]!;
  }

  it('state from another browser (no / different cookie) is rejected', async () => {
    await login();
    const noCookie = await app.inject({
      method: 'GET',
      url: '/auth/external/google/callback?code=c&state=state-abc',
    });
    expect(noCookie.statusCode).toBe(400);
    expect(noCookie.json().code).toBe('EXTERNAL_AUTH_STATE_MISMATCH');
    const otherBrowser = await app.inject({
      method: 'GET',
      url: '/auth/external/google/callback?code=c&state=state-abc',
      headers: { cookie: 'ext_auth_state=attacker-state' },
    });
    expect(otherBrowser.json().code).toBe('EXTERNAL_AUTH_STATE_MISMATCH');
    expect(handleCallback).not.toHaveBeenCalled();
  });

  it('SAML POST callback also requires the RelayState cookie', async () => {
    const res = await app.inject({
      method: 'POST',
      url: '/auth/external/saml/callback',
      payload: { SAMLResponse: 'x', RelayState: 'state-abc' },
    });
    expect(res.json().code).toBe('EXTERNAL_AUTH_STATE_MISMATCH');
    expect(handleCallback).not.toHaveBeenCalled();
  });

  it('tokens are delivered via a one-time ticket, not the redirect URL', async () => {
    const cookie = await login();
    const cb = await app.inject({
      method: 'GET',
      url: '/auth/external/google/callback?code=c&state=state-abc',
      headers: { cookie },
    });
    expect(cb.statusCode).toBe(302);
    const location = String(cb.headers.location);
    expect(location).not.toContain('AT-secret');
    expect(location).not.toContain('RT-secret');
    expect(location).not.toContain('access_token');
    const ticket = new URL(location).searchParams.get('ticket')!;
    const redeemed = await app.inject({
      method: 'GET',
      url: `/auth/external/ticket?ticket=${ticket}`,
    });
    expect(redeemed.statusCode).toBe(200);
    expect(redeemed.json().tokens.accessToken).toBe('AT-secret');
    const again = await app.inject({
      method: 'GET',
      url: `/auth/external/ticket?ticket=${ticket}`,
    });
    expect(again.statusCode).toBe(401);
  });
});
