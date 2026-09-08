/**
 * G-604 — sandbox delivery adapter unit tests.
 */
import { describe, expect, it } from 'vitest';

import { COMMS_SANDBOX_HONESTY_NOTE, createSandboxDeliveryAdapter } from './delivery-adapter.js';

describe('createSandboxDeliveryAdapter (G-604)', () => {
  it('returns sandbox delivery metadata without calling providers', async () => {
    const adapter = createSandboxDeliveryAdapter();
    const result = await adapter.deliver({
      tenantId: '550e8400-e29b-41d4-a716-446655440000',
      channels: ['email', 'sms'],
      body: 'Hello',
      estimatedRecipients: 12,
    });
    expect(result.mode).toBe('sandbox');
    expect(result.messageId).toMatch(/^sandbox-comms:/);
    expect(result.channelsAttempted).toEqual(['email', 'sms']);
    expect(result.honestyNote).toBe(COMMS_SANDBOX_HONESTY_NOTE);
  });

  it('defaults to in_app when channels empty', async () => {
    const adapter = createSandboxDeliveryAdapter();
    const result = await adapter.deliver({
      tenantId: 't1',
      channels: [],
    });
    expect(result.channelsAttempted).toEqual(['in_app']);
  });
});
