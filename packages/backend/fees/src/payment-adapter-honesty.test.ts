/**
 * W2-INT-03: live PSP mode must not silently succeed via sandbox stub.
 */
import { describe, expect, it } from 'vitest';

import { createPaymentAdapterFromEnv } from './payment-adapter.js';

describe('W2-INT-03 fees payment adapter honesty', () => {
  it('fails closed when PROVIDER_MODE=live (PSP adapter not implemented)', async () => {
    const adapter = createPaymentAdapterFromEnv({
      PROVIDER_MODE: 'live',
      PSP_API_KEY: 'pk_live_stub',
    });
    const result = await adapter.charge({
      tenantId: 't1',
      invoiceId: 'inv-1',
      payerUserId: 'u1',
      amountCents: 1000,
      currency: 'INR',
    });
    expect(result.status).toBe('failed');
    expect(result.reference).toMatch(/live-psp-unimplemented|refused/);
  });

  it('sandbox still succeeds with sandbox reference', async () => {
    const adapter = createPaymentAdapterFromEnv({});
    const result = await adapter.charge({
      tenantId: 't1',
      invoiceId: 'inv-2',
      payerUserId: 'u1',
      amountCents: 500,
      currency: 'INR',
    });
    expect(result.status).toBe('succeeded');
    expect(result.reference).toMatch(/^sandbox-/);
  });
});
