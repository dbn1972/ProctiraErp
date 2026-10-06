/**
 * PRC-M497 — the public SMS OTP send endpoint must be bound to a server-side
 * primary-auth step: client-supplied userId/phone are ignored, the tenant must
 * match the host, and verify never leaks a bare userId/tenantId.
 */
import Fastify, { type FastifyInstance, type FastifyRequest } from 'fastify';
import { afterEach, describe, expect, it, vi } from 'vitest';

import { registerMfaRoutes, type MfaRoutesOptions } from './mfa-routes.js';
import { InMemoryOtpChallengeStore, OtpService } from './otp-service.js';
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
