/**
 * PRC-M497: the Keycloak `/password` step mints the pre-MFA ticket that binds
 * `/auth/mfa/otp/send` and `/auth/mfa/verify` to the login, and the completion
 * ticket `/auth/mfa/verify` returns is redeemed at `/password/mfa` for the
 * tokens held for that same challenge (single use, never for another one).
 */
import Fastify, { type FastifyInstance } from 'fastify';
import { afterEach, describe, expect, it, vi } from 'vitest';

import { registerMfaRoutes } from '../mfa-routes.js';
import { InMemoryOtpChallengeStore, OtpService } from '../otp-service.js';
import { createPreMfaTicketCodec, PRE_MFA_TICKET_HEADER } from '../pre-mfa-ticket.js';
import { ConsoleSmsProvider } from '../sms-provider.js';
import {
  createMfaCompletionTicketIssuer,
  MemoryWebTicketStore,
  registerKeycloakAuthRoutes,
  type MfaPolicyDecision,
} from './routes.js';

const BASE = {
  issuer: 'http://localhost:8180/realms/proctira',
  clientId: 'proctira-gateway',
  realm: 'proctira',
  jwksUri: 'http://localhost:8180/realms/proctira/protocol/openid-connect/certs',
  redirectUri: 'http://localhost:3200/api/v1/auth/callback',
};

function makeAccessToken(claims: Record<string, unknown>): string {
  const header = Buffer.from(JSON.stringify({ alg: 'RS256', typ: 'JWT' })).toString('base64url');
  const payload = Buffer.from(JSON.stringify(claims)).toString('base64url');
  return `${header}.${payload}.sig`;
}
const ACCESS = makeAccessToken({ sub: 'kc-u', email: 'u@proctira.in', tenant_id: 'tenant-1' });
const ACCESS_V = makeAccessToken({ sub: 'kc-v', email: 'v@proctira.in', tenant_id: 'tenant-1' });

async function build(): Promise<FastifyInstance> {
  vi.spyOn(globalThis, 'fetch').mockImplementation(async (_url, init) => {
    const body = String((init as RequestInit | undefined)?.body ?? '');
    if (body.includes('grant_type=password')) {
      return new Response(
        JSON.stringify({
          access_token: body.includes('username=v%40proctira.in') ? ACCESS_V : ACCESS,
          refresh_token: 'refresh-1',
          token_type: 'Bearer',
          expires_in: 300,
        }),
        { status: 200, headers: { 'content-type': 'application/json' } },
      );
    }
    return new Response('', { status: 204 });
  });
  const otpService = new OtpService({
    store: new InMemoryOtpChallengeStore(),
    sms: new ConsoleSmsProvider(),
    exposeCodeInResponse: true,
  });
  const preMfaTicket = createPreMfaTicketCodec({ secret: 'm497-pre-mfa-ticket-secret-0123456789' });
  const mfaCompletionStore = new MemoryWebTicketStore();
  const app = Fastify();
  await registerKeycloakAuthRoutes(app, {
    ...BASE,
    otpService,
    preMfaTicket,
    mfaCompletionStore,
    mfaPolicy: async ({ userId }): Promise<MfaPolicyDecision> => ({
      required: true,
      phone: userId === 'kc-v' ? '+15550002222' : '+15550001111',
    }),
  });
  await registerMfaRoutes(app, {
    otpService,
    preMfaTicket,
    prefix: '/api/v1/auth',
    issueCompletionTicket: createMfaCompletionTicketIssuer(mfaCompletionStore),
  });
  await app.ready();
  return app;
}

async function startLogin(app: FastifyInstance, username = 'u@proctira.in') {
  const res = await app.inject({
    method: 'POST',
    url: '/api/v1/auth/password',
    payload: { username, password: 'pw' },
  });
  expect(res.statusCode).toBe(401);
  return res.json() as {
    status: string;
    mfaToken: string;
    debugCode: string;
    preMfaTicket?: string;
  };
}

describe('PRC-M497 pre-MFA ticket and completion ticket on the Keycloak password flow', () => {
  let app: FastifyInstance | undefined;
  afterEach(async () => {
    vi.restoreAllMocks();
    await app?.close();
    app = undefined;
  });

  it('mfa_required carries a pre-MFA ticket for the password-authenticated principal', async () => {
    app = await build();
    const started = await startLogin(app);
    expect(started.status).toBe('mfa_required');
    expect(typeof started.preMfaTicket).toBe('string');
    const verifyWithout = await app.inject({
      method: 'POST',
      url: '/api/v1/auth/mfa/verify',
      payload: { mfaToken: started.mfaToken, code: started.debugCode },
    });
    expect(verifyWithout.statusCode).toBe(401);
    expect(verifyWithout.json().code).toBe('PRIMARY_AUTH_REQUIRED');
  });

  it('verify returns a completion ticket that releases the held tokens once', async () => {
    app = await build();
    const started = await startLogin(app);
    const verified = await app.inject({
      method: 'POST',
      url: '/api/v1/auth/mfa/verify',
      headers: { [PRE_MFA_TICKET_HEADER]: started.preMfaTicket ?? '' },
      payload: { mfaToken: started.mfaToken, code: started.debugCode },
    });
    expect(verified.statusCode, verified.body).toBe(200);
    const { completionTicket } = verified.json() as { completionTicket?: string };
    expect(typeof completionTicket).toBe('string');

    const done = await app.inject({
      method: 'POST',
      url: '/api/v1/auth/password/mfa',
      payload: { mfaToken: started.mfaToken, completionTicket },
    });
    expect(done.statusCode, done.body).toBe(200);
    expect(done.json().accessToken).toBe(ACCESS);

    const replay = await app.inject({
      method: 'POST',
      url: '/api/v1/auth/password/mfa',
      payload: { mfaToken: started.mfaToken, completionTicket },
    });
    expect(replay.statusCode).toBe(401);
    expect(replay.json().accessToken).toBeUndefined();
  });

  it('a completion ticket cannot release another challenge`s tokens, and forged ones fail', async () => {
    app = await build();
    const first = await startLogin(app);
    const second = await startLogin(app, 'v@proctira.in');
    const verified = await app.inject({
      method: 'POST',
      url: '/api/v1/auth/mfa/verify',
      headers: { [PRE_MFA_TICKET_HEADER]: first.preMfaTicket ?? '' },
      payload: { mfaToken: first.mfaToken, code: first.debugCode },
    });
    const { completionTicket } = verified.json() as { completionTicket: string };
    const crossed = await app.inject({
      method: 'POST',
      url: '/api/v1/auth/password/mfa',
      payload: { mfaToken: second.mfaToken, completionTicket },
    });
    expect(crossed.statusCode).toBe(401);
    expect(crossed.json().accessToken).toBeUndefined();
    const forged = await app.inject({
      method: 'POST',
      url: '/api/v1/auth/password/mfa',
      payload: { mfaToken: second.mfaToken, completionTicket: 'A'.repeat(43) },
    });
    expect(forged.statusCode).toBe(401);
  });
});
