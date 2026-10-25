/**
 * Unit tests for sandbox channel senders + delivery capabilities.
 */
import { describe, expect, it } from 'vitest';
import {
  LIVE_EMAIL_UNIMPLEMENTED_NOTE,
  LIVE_PUSH_UNIMPLEMENTED_NOTE,
  LIVE_SMS_UNIMPLEMENTED_NOTE,
} from './channel-sender-factory.js';

import { InMemoryNotificationRepository } from './in-memory-repository.js';
import { NotificationService } from './notification-service.js';
import { createSandboxEmailSender, EMAIL_SANDBOX_HONESTY_NOTE } from './sandbox-email-sender.js';
import { createSandboxPushSender, PUSH_SANDBOX_HONESTY_NOTE } from './sandbox-push-sender.js';
import { createSandboxSmsSender, SMS_SANDBOX_HONESTY_NOTE } from './sandbox-sms-sender.js';

describe('sandbox channel senders', () => {
  it('accepts SMS without a carrier', async () => {
    const sender = createSandboxSmsSender();
    const result = await sender.send({
      to: 'user-1',
      body: 'Hello',
      tenantId: '550e8400-e29b-41d4-a716-446655440000',
    });
    expect(result.success).toBe(true);
    expect(result.mode).toBe('sandbox');
    expect(result.honestyNote).toBe(SMS_SANDBOX_HONESTY_NOTE);
  });

  it('accepts email without SMTP', async () => {
    const sender = createSandboxEmailSender();
    const result = await sender.send({
      to: 'user-1',
      subject: 'Hi',
      body: 'Hello',
      tenantId: '550e8400-e29b-41d4-a716-446655440000',
    });
    expect(result.success).toBe(true);
    expect(result.mode).toBe('sandbox');
    expect(result.honestyNote).toBe(EMAIL_SANDBOX_HONESTY_NOTE);
  });

  it('accepts push without FCM', async () => {
    const sender = createSandboxPushSender();
    const result = await sender.send({
      userId: 'user-1',
      title: 'Hi',
      body: 'Hello',
      tenantId: '550e8400-e29b-41d4-a716-446655440000',
    });
    expect(result.success).toBe(true);
    expect(result.mode).toBe('sandbox');
    expect(result.honestyNote).toBe(PUSH_SANDBOX_HONESTY_NOTE);
  });

  it('exposes delivery capabilities for email, push, and SMS', () => {
    const service = new NotificationService(
      new InMemoryNotificationRepository(),
      createSandboxEmailSender(),
      createSandboxPushSender(),
      undefined,
      createSandboxSmsSender(),
    );
    const caps = service.getDeliveryCapabilities();
    expect(caps.email.mode).toBe('sandbox');
    expect(caps.push.mode).toBe('sandbox');
    expect(caps.sms.mode).toBe('sandbox');
    expect(caps.email.honestyNote).toContain('Sandbox email');
    expect(caps.push.honestyNote).toContain('Sandbox push');
    expect(caps.sms.honestyNote).toContain('Sandbox SMS');
  });
});

// PRC-L333: capabilities follow the same env policy as the sender factory.
describe('delivery capabilities follow provider mode (PRC-L333)', () => {
  const service = () => new NotificationService(new InMemoryNotificationRepository());

  it('reports live mode with the live honesty notes when PROVIDER_MODE=live', () => {
    const caps = service().getDeliveryCapabilities({ PROVIDER_MODE: 'live' });
    expect(caps).toEqual({
      email: { mode: 'live', honestyNote: LIVE_EMAIL_UNIMPLEMENTED_NOTE },
      push: { mode: 'live', honestyNote: LIVE_PUSH_UNIMPLEMENTED_NOTE },
      sms: { mode: 'live', honestyNote: LIVE_SMS_UNIMPLEMENTED_NOTE },
    });
  });

  it('keeps the sandbox output for an empty env and for production sandbox opt-in', () => {
    const sandbox = service().getDeliveryCapabilities({});
    expect(sandbox.email.mode).toBe('sandbox');
    expect(sandbox.sms.honestyNote).toContain('Sandbox SMS');
    expect(
      service().getDeliveryCapabilities({ NODE_ENV: 'production', ALLOW_SANDBOX_PROVIDERS: '1' }),
    ).toEqual(sandbox);
  });
});
