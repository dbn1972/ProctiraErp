/**
 * PRC-M497 — the public SMS OTP send endpoint must be bound to a server-side
 * primary-auth step: client-supplied userId/phone are ignored, the tenant must
 * match the host, and verify never leaks a bare userId/tenantId.
 */
import Fastify, { type FastifyInstance, type FastifyRequest } from 'fastify';
import { afterEach, describe, expect, it, vi } from 'vitest';

import { registerMfaRoutes, type MfaRoutesOptions } from './mfa-routes.js';
import { InMemoryOtpChallengeStore, OtpService } from './otp-service.js';
import { createPreMfaTicketCodec, createPreMfaTicketCodecFromEnv } from './pre-mfa-ticket.js';
import type { SmsProvider } from './sms-provider.js';

const HOST_TENANT = 'tenant-a';

function build(options: Partial<MfaRoutesOptions> = {}) {
  const sent: Array<{ to: string; body: string }> = [];
  const sms: SmsProvider = {
    name: 'test',
    send: vi.fn(async (msg: { to: string; body: string }) => {
      sent.push(msg);
    }),
  } as unknown as SmsProvider;
  const otpService = new OtpService({
    store: new InMemoryOtpChallengeStore(),
    sms,
    pepper: 'pepper',
    exposeCodeInResponse: true,
  });
  const app = Fastify();
  app.addHook('onRequest', async (request) => {
    (request as FastifyRequest & { tenantId?: string }).tenantId = HOST_TENANT;
  });
  return {
    sent,
    app,
    ready: registerMfaRoutes(app, { otpService, prefix: '/auth', ...options }).then(() =>
      app.ready(),
    ),
  };
}

let current: FastifyInstance | undefined;
afterEach(async () => {
  await current?.close();
  current = undefined;
});

describe('PRC-M497 OTP send bound to primary auth', () => {
  it('rejects send without a primary-auth step, even with userId + attacker phone', async () => {
    const { app, ready, sent } = build({ resolvePhone: async () => '+15550001111' });
    current = app;
    await ready;
    const res = await app.inject({
      method: 'POST',
      url: '/auth/mfa/otp/send',
      payload: { userId: 'victim', phone: '+19990009999', tenantId: HOST_TENANT },
    });
    expect(res.statusCode).toBe(401);
    expect(res.json().code).toBe('PRIMARY_AUTH_REQUIRED');
    expect(sent).toHaveLength(0);
  });

  it('rejects a body tenantId that differs from the host tenant', async () => {
    const { app, ready, sent } = build({
      resolvePrimaryAuth: async () => ({ userId: 'u1', tenantId: HOST_TENANT }),
      resolvePhone: async () => '+15550001111',
    });
    current = app;
    await ready;
    const res = await app.inject({
      method: 'POST',
      url: '/auth/mfa/otp/send',
      payload: { tenantId: 'tenant-b' },
    });
    expect(res.statusCode).toBe(400);
    expect(res.json().code).toBe('TENANT_MISMATCH');
    expect(sent).toHaveLength(0);
  });

  it('rejects a primary-auth identity from another tenant', async () => {
    const { app, ready } = build({
      resolvePrimaryAuth: async () => ({ userId: 'u1', tenantId: 'tenant-b' }),
      resolvePhone: async () => '+15550001111',
    });
    current = app;
    await ready;
    const res = await app.inject({ method: 'POST', url: '/auth/mfa/otp/send', payload: {} });
    expect(res.statusCode).toBe(403);
  });

  it('ignores client phone and sends to the server-resolved phone only', async () => {
    const resolvePhone = vi.fn(async () => '+15550001111');
    const { app, ready, sent } = build({
      resolvePrimaryAuth: async () => ({ userId: 'u1', tenantId: HOST_TENANT }),
      resolvePhone,
    });
    current = app;
    await ready;
    const res = await app.inject({
      method: 'POST',
      url: '/auth/mfa/otp/send',
      payload: { phone: '+19990009999', userId: 'victim' },
    });
    expect(res.statusCode, res.body).toBe(200);
    expect(sent.map((m) => m.to)).toEqual(['+15550001111']);
    expect(resolvePhone).toHaveBeenCalledWith({ userId: 'u1', tenantId: HOST_TENANT });
  });

  it('verify returns no userId/tenantId; only an opaque completion ticket', async () => {
    const { app, ready } = build({
      resolvePrimaryAuth: async () => ({ userId: 'u1', tenantId: HOST_TENANT }),
      resolvePhone: async () => '+15550001111',
      issueCompletionTicket: async () => 'ticket-xyz',
    });
    current = app;
    await ready;
    const sent = await app.inject({ method: 'POST', url: '/auth/mfa/otp/send', payload: {} });
    const { mfaToken, debugCode } = sent.json() as { mfaToken: string; debugCode: string };
    const res = await app.inject({
      method: 'POST',
      url: '/auth/mfa/verify',
      payload: { mfaToken, code: debugCode },
    });
    expect(res.statusCode, res.body).toBe(200);
    const body = res.json() as Record<string, unknown>;
    expect(body).not.toHaveProperty('userId');
    expect(body).not.toHaveProperty('tenantId');
    expect(body['completionTicket']).toBe('ticket-xyz');
  });

  it('verify of an unknown challenge returns 401 and no identity', async () => {
    const { app, ready } = build();
    current = app;
    await ready;
    const res = await app.inject({
      method: 'POST',
      url: '/auth/mfa/verify',
      payload: { mfaToken: 'forged', code: '000000' },
    });
    expect(res.statusCode).toBe(401);
    expect(res.json()).not.toHaveProperty('userId');
  });
});

describe('PRC-M497 pre-MFA ticket binds OTP send and verify to the login', () => {
  const codec = createPreMfaTicketCodec({ secret: 'pre-mfa-test-secret-0123456789abcdef' });
  const phones: Record<string, string> = { u1: '+15550001111', u2: '+15550002222' };
  const withTicket = () =>
    build({
      preMfaTicket: codec,
      resolvePhone: async ({ userId }) => phones[userId!] ?? null,
    });

  it('send without a ticket or with a forged / foreign-key ticket -> 401', async () => {
    const { app, ready, sent } = withTicket();
    current = app;
    await ready;
    const none = await app.inject({
      method: 'POST',
      url: '/auth/mfa/otp/send',
      payload: { userId: 'u1' },
    });
    expect(none.statusCode).toBe(401);
    const foreign = createPreMfaTicketCodec({ secret: 'another-secret-0123456789abcdefghij' });
    const forged = await app.inject({
      method: 'POST',
      url: '/auth/mfa/otp/send',
      headers: { 'x-pre-mfa-ticket': foreign.mint({ userId: 'u1', tenantId: HOST_TENANT }) },
      payload: {},
    });
    expect(forged.statusCode).toBe(401);
    expect(sent).toHaveLength(0);
  });

  it('an expired ticket -> 401', async () => {
    const old = createPreMfaTicketCodec({
      secret: 'pre-mfa-test-secret-0123456789abcdef',
      now: () => Date.now() - 10 * 60_000,
    });
    const { app, ready } = withTicket();
    current = app;
    await ready;
    const res = await app.inject({
      method: 'POST',
      url: '/auth/mfa/otp/send',
      headers: { 'x-pre-mfa-ticket': old.mint({ userId: 'u1', tenantId: HOST_TENANT }) },
      payload: {},
    });
    expect(res.statusCode).toBe(401);
  });

  it('a valid ticket sends to the ticket user’s phone; body identity is ignored', async () => {
    const { app, ready, sent } = withTicket();
    current = app;
    await ready;
    const res = await app.inject({
      method: 'POST',
      url: '/auth/mfa/otp/send',
      headers: { 'x-pre-mfa-ticket': codec.mint({ userId: 'u1', tenantId: HOST_TENANT }) },
      payload: { userId: 'u2', phone: '+19990000000' },
    });
    expect(res.statusCode, res.body).toBe(200);
    expect(sent.map((m) => m.to)).toEqual(['+15550001111']);
  });

  it('verify requires the ticket and refuses a challenge of another login', async () => {
    const { app, ready } = withTicket();
    current = app;
    await ready;
    const ticketU1 = codec.mint({ userId: 'u1', tenantId: HOST_TENANT });
    const sent = await app.inject({
      method: 'POST',
      url: '/auth/mfa/otp/send',
      payload: { preMfaTicket: ticketU1 },
    });
    const { mfaToken, debugCode } = sent.json() as { mfaToken: string; debugCode: string };
    const noTicket = await app.inject({
      method: 'POST',
      url: '/auth/mfa/verify',
      payload: { mfaToken, code: debugCode },
    });
    expect(noTicket.statusCode).toBe(401);
    expect(noTicket.json().code).toBe('PRIMARY_AUTH_REQUIRED');
    const otherLogin = await app.inject({
      method: 'POST',
      url: '/auth/mfa/verify',
      headers: { 'x-pre-mfa-ticket': codec.mint({ userId: 'u2', tenantId: HOST_TENANT }) },
      payload: { mfaToken, code: debugCode },
    });
    expect(otherLogin.statusCode).toBe(401);
    expect(otherLogin.json().code).toBe('MFA_BINDING_MISMATCH');
  });

  it('verify with the matching ticket succeeds', async () => {
    const { app, ready } = withTicket();
    current = app;
    await ready;
    const ticket = codec.mint({ userId: 'u1', tenantId: HOST_TENANT });
    const sent = await app.inject({
      method: 'POST',
      url: '/auth/mfa/otp/send',
      headers: { 'x-pre-mfa-ticket': ticket },
      payload: {},
    });
    const { mfaToken, debugCode } = sent.json() as { mfaToken: string; debugCode: string };
    const ok = await app.inject({
      method: 'POST',
      url: '/auth/mfa/verify',
      headers: { 'x-pre-mfa-ticket': ticket },
      payload: { mfaToken, code: debugCode },
    });
    expect(ok.statusCode, ok.body).toBe(200);
    expect(ok.json()).toMatchObject({ success: true });
  });
});

describe('PRC-M497 pre-MFA ticket secret policy', () => {
  it('deployed: a short or JWT_SECRET-reusing key refuses boot; unset disables tickets', () => {
    const strong = 'z'.repeat(40);
    expect(() =>
      createPreMfaTicketCodecFromEnv({ NODE_ENV: 'production', MFA_PRE_TICKET_SECRET: 'short' }),
    ).toThrow(/at least 32/);
    expect(() =>
      createPreMfaTicketCodecFromEnv({
        NODE_ENV: 'staging',
        MFA_PRE_TICKET_SECRET: strong,
        JWT_SECRET: strong,
      }),
    ).toThrow(/JWT_SECRET/);
    expect(createPreMfaTicketCodecFromEnv({ NODE_ENV: 'production' })).toBeNull();
    expect(createPreMfaTicketCodecFromEnv({ NODE_ENV: 'test' })).not.toBeNull();
  });
});
