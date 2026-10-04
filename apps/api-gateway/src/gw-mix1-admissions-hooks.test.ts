/**
 * PRC-M018 — admissions offer-fee hooks: an unpaid invoice is rejected even
 * with an arbitrary client paymentRef, and concurrent createOfferFeeInvoice
 * calls for one application yield exactly one invoice.
 */
import { randomUUID } from 'node:crypto';

import { createFeesRepository, FeesService } from '@proctira/backend-fees';
import { describe, expect, it } from 'vitest';

import { assertOfferFeePaidHook, createOfferFeeInvoiceHook } from './domain-plugins.js';

delete process.env['DATABASE_URL'];

const TENANT = '880e8400-e29b-41d4-a716-446655440088';

function offerInput(applicationId: string) {
  return {
    tenantId: TENANT,
    applicationId,
    offerId: `offer-${applicationId}`,
    firstName: 'Asha',
    lastName: 'Rao',
    dateOfBirth: '2015-04-01',
    gender: 'female',
    guardianName: 'Ravi Rao',
    guardianPhone: '+919800000000',
    guardianEmail: null,
    feeAmount: 2500,
    feeCurrency: 'INR',
  };
}

describe('admissions offer-fee hooks (PRC-M018)', () => {
  it('unpaid invoice + arbitrary paymentRef is rejected', async () => {
    const input = offerInput(randomUUID());
    const { invoiceId } = await createOfferFeeInvoiceHook()(input);
    // PRC-M327: pass the matching offer so the paid check (not the match check) decides.
    await expect(
      assertOfferFeePaidHook()({
        tenantId: TENANT,
        invoiceId,
        applicationId: input.applicationId,
        offerId: input.offerId,
        expectedAmount: input.feeAmount,
        expectedCurrency: input.feeCurrency,
        paymentRef: 'pay_fake_123',
      }),
    ).rejects.toThrow(/must be paid/);
  });

  it('concurrent createOfferFeeInvoice for one application yields one invoice', async () => {
    const applicationId = randomUUID();
    const hook = createOfferFeeInvoiceHook();
    const results = await Promise.all(
      Array.from({ length: 5 }, () => hook(offerInput(applicationId))),
    );
    const ids = new Set(results.map((r) => r.invoiceId));
    expect(ids.size).toBe(1);
    const fees = new FeesService(createFeesRepository());
    const invoices = (await fees.listInvoicesForStudentIds(TENANT, [applicationId])).filter(
      (i) => i.description === `Admission application ${applicationId}`,
    );
    expect(invoices).toHaveLength(1);
  });
});
