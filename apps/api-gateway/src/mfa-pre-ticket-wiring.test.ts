/**
 * PRC-M497 — the gateway mounts the MFA routes with the pre-MFA ticket as the
 * primary-auth binding: OTP send accepts only a ticket signed with
 * MFA_PRE_TICKET_SECRET, and client body identity is never trusted.
 */
import { createPreMfaTicketCodec } from '@proctira/backend-auth';
import type { FastifyInstance } from 'fastify';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';

import { TEST_TENANT_ID, createTestConfig } from './__tests__/gateway-test-kit.js';
import { buildApp } from './app.js';

delete process.env['DATABASE_URL'];

const SECRET = 'm497-gateway-pre-mfa-secret-0123456789';

describe('PRC-M497 gateway OTP routes are bound to the pre-MFA ticket', () => {
  let app: FastifyInstance;
  let saved: string | undefined;

  beforeAll(async () => {
    saved = process.env['MFA_PRE_TICKET_SECRET'];
    process.env['MFA_PRE_TICKET_SECRET'] = SECRET;
    app = await buildApp({ config: createTestConfig() });
    await app.ready();
  });

  afterAll(async () => {
    await app.close();
    if (saved === undefined) delete process.env['MFA_PRE_TICKET_SECRET'];
    else process.env['MFA_PRE_TICKET_SECRET'] = saved;
  });

  it('send with body identity but no ticket -> 401 PRIMARY_AUTH_REQUIRED', async () => {
    const res = await app.inject({
      method: 'POST',
      url: '/api/v1/auth/mfa/otp/send',
      payload: { userId: 'victim', phone: '+19990000000' },
    });
    expect(res.statusCode).toBe(401);
    expect(res.json().code).toBe('PRIMARY_AUTH_REQUIRED');
  });

  it('a ticket signed with another key -> 401', async () => {
    const foreign = createPreMfaTicketCodec({ secret: 'not-the-gateway-key-0123456789abcdef' });
    const res = await app.inject({
      method: 'POST',
      url: '/api/v1/auth/mfa/otp/send',
      headers: { 'x-pre-mfa-ticket': foreign.mint({ userId: 'u1', tenantId: TEST_TENANT_ID }) },
      payload: {},
    });
    expect(res.statusCode).toBe(401);
  });

  it('a gateway-signed ticket passes the primary-auth binding', async () => {
    const codec = createPreMfaTicketCodec({ secret: SECRET });
    const res = await app.inject({
      method: 'POST',
      url: '/api/v1/auth/mfa/otp/send',
      headers: { 'x-pre-mfa-ticket': codec.mint({ userId: 'u1', tenantId: TEST_TENANT_ID }) },
      payload: { phone: '+19990000000' },
    });
    // Bound to the login; the gateway has no server-side phone source wired, so
    // it refuses rather than texting a client-supplied number.
    expect(res.statusCode).toBe(400);
    expect(res.json().code).toBe('MFA_PHONE_UNAVAILABLE');
  });

  it('verify without the ticket -> 401 PRIMARY_AUTH_REQUIRED', async () => {
    const res = await app.inject({
      method: 'POST',
      url: '/api/v1/auth/mfa/verify',
      payload: { mfaToken: 'any', code: '123456' },
    });
    expect(res.statusCode).toBe(401);
    expect(res.json().code).toBe('PRIMARY_AUTH_REQUIRED');
  });
});
