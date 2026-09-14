/**
 * W2-INT-03: live communication delivery must not silently mark sent via stub.
 */
import { describe, expect, it } from 'vitest';

import { createDeliveryAdapterFromEnv } from './delivery-adapter.js';

describe('W2-INT-03 communication live delivery honesty', () => {
  it('throws / refuses when PROVIDER_MODE=live without a live adapter', async () => {
    const adapter = createDeliveryAdapterFromEnv({ PROVIDER_MODE: 'live', TWILIO_AUTH_TOKEN: 'x' });
    await expect(
      adapter.deliver({
        tenantId: 't1',
        channels: ['sms'],
        subject: 'Alert',
        body: 'Body',
      }),
    ).rejects.toThrow(/not implemented|refusing silent/i);
  });

  it('sandbox still returns sandbox mode', async () => {
    const adapter = createDeliveryAdapterFromEnv({});
    const result = await adapter.deliver({
      tenantId: 't1',
      channels: ['email'],
      body: 'hi',
    });
    expect(result.mode).toBe('sandbox');
    expect(result.honestyNote).toMatch(/Sandbox/);
  });
});
