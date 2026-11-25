/**
 * PRC-M535: the gateway hook that checks a guardian paymentRef against the fees
 * ledger. An unknown/foreign invoice is "not recorded" (false), other errors
 * propagate so the accept fails closed.
 */
import { NotFoundError } from '@proctira/common';
import { describe, expect, it } from 'vitest';
import { verifyOfferFeePaymentRefHook } from './domain-plugins.js';

const input = { tenantId: 't-1', invoiceId: 'inv-1', paymentRef: 'PAY-1' };

describe('PRC-M535 verifyOfferFeePaymentRefHook', () => {
  it('returns the fees ledger answer for the offer invoice', async () => {
    const calls: unknown[] = [];
    const hook = verifyOfferFeePaymentRefHook(() => ({
      isRecordedPaymentRef: async (...args: unknown[]) => {
        calls.push(args);
        return true;
      },
    }));
    expect(await hook(input)).toBe(true);
    expect(calls).toEqual([['t-1', 'inv-1', 'PAY-1']]);
  });

  it('treats an invoice the tenant cannot see as no recorded payment', async () => {
    const hook = verifyOfferFeePaymentRefHook(() => ({
      isRecordedPaymentRef: async () => {
        throw new NotFoundError('Invoice not found');
      },
    }));
    expect(await hook(input)).toBe(false);
  });

  it('propagates other errors (fail closed)', async () => {
    const hook = verifyOfferFeePaymentRefHook(() => ({
      isRecordedPaymentRef: async () => {
        throw new Error('db down');
      },
    }));
    await expect(hook(input)).rejects.toThrow('db down');
  });
});
