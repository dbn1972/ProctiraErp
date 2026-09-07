/**
 * Unit tests for sandbox SMS sender + delivery capabilities.
 */
import { describe, expect, it } from 'vitest';

import { InMemoryNotificationRepository } from './in-memory-repository.js';
import { NotificationService } from './notification-service.js';
import { createSandboxSmsSender, SMS_SANDBOX_HONESTY_NOTE } from './sandbox-sms-sender.js';

describe('sandbox SMS sender', () => {
  it('accepts messages without a carrier', async () => {
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

  it('exposes delivery capabilities honesty note', () => {
    const service = new NotificationService(
      new InMemoryNotificationRepository(),
      undefined,
      undefined,
      undefined,
      createSandboxSmsSender(),
    );
    const caps = service.getDeliveryCapabilities();
    expect(caps.sms.mode).toBe('sandbox');
    expect(caps.sms.honestyNote).toContain('Sandbox SMS');
  });
});
