/**
 * W2-INT-03: PROVIDER_MODE=live must not silently succeed via sandbox stubs.
 * W1-ARCH-08: production refuses silent sandbox defaults.
 */
import { describe, expect, it } from 'vitest';

import {
  createEmailSenderFromEnv,
  createPushSenderFromEnv,
  createSmsSenderFromEnv,
} from './channel-sender-factory.js';

describe('W2-INT-03 notification live sender honesty', () => {
  it('refuses silent success when PROVIDER_MODE=live (no live adapter wired)', async () => {
    const env = { PROVIDER_MODE: 'live', TWILIO_AUTH_TOKEN: 'x', SMTP_URL: 'smtp://x', FCM_SERVER_KEY: 'x' };
    const sms = await createSmsSenderFromEnv(env).send({
      to: '+1000',
      body: 'hi',
      tenantId: 't1',
    });
    const email = await createEmailSenderFromEnv(env).send({
      to: 'a@b.c',
      subject: 's',
      body: 'b',
      tenantId: 't1',
    });
    const push = await createPushSenderFromEnv(env).send({
      userId: 'u1',
      title: 't',
      body: 'b',
      tenantId: 't1',
    });

    expect(sms.success).toBe(false);
    expect(email.success).toBe(false);
    expect(push.success).toBe(false);
    expect(sms.mode).toBe('live');
    expect(email.mode).toBe('live');
    expect(push.mode).toBe('live');
    expect(sms.error).toMatch(/not implemented|refusing silent/i);
  });

  it('sandbox mode still accepts with honesty metadata', async () => {
    const env = { PROVIDER_MODE: 'sandbox' };
    const sms = await createSmsSenderFromEnv(env).send({
      to: '+1000',
      body: 'hi',
      tenantId: 't1',
    });
    expect(sms.success).toBe(true);
    expect(sms.mode).toBe('sandbox');
    expect(sms.honestyNote).toMatch(/Sandbox SMS/);
  });

  it('W1-ARCH-08: throws when production would silently use sandbox senders', () => {
    expect(() => createSmsSenderFromEnv({ NODE_ENV: 'production' })).toThrow(/W1-ARCH-08/);
    expect(() => createEmailSenderFromEnv({ NODE_ENV: 'production' })).toThrow(/W1-ARCH-08/);
    expect(() => createPushSenderFromEnv({ NODE_ENV: 'production' })).toThrow(/W1-ARCH-08/);
  });

  it('W1-ARCH-08: allows sandbox senders in production with explicit opt-in', async () => {
    const env = { NODE_ENV: 'production', ALLOW_SANDBOX_PROVIDERS: '1' };
    const sms = await createSmsSenderFromEnv(env).send({
      to: '+1000',
      body: 'hi',
      tenantId: 't1',
    });
    expect(sms.success).toBe(true);
    expect(sms.mode).toBe('sandbox');
  });
});
