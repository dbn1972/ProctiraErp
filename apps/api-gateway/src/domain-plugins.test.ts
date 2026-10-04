/**
 * PRC-C002 regression guard: the admission offer-fee decision must never treat anything other
 * than a genuinely paid invoice as proof of payment. This tests the real decision function used
 * by assertOfferFeePaidHook (not an injected fake), so a revert to the old
 * "any paymentRef settles" behaviour is caught here.
 */
import { BusinessRuleError } from '@proctira/common';
import { describe, expect, it, vi } from 'vitest';

import {
  assertOfferFeeInvoiceMatchesOffer,
  assertOfferFeeInvoicePaid,
  assertOfferFeePaidHook,
  verifyOfferFeeInvoiceOwnershipHook,
} from './domain-plugins.js';

describe('assertOfferFeeInvoicePaid (PRC-C002)', () => {
  it('passes only when the offer-fee invoice is genuinely paid', () => {
    expect(() => assertOfferFeeInvoicePaid('paid')).not.toThrow();
  });

  it.each(['open', 'void', 'written_off', 'partial', '', 'PAID', 'paid '])(
    'refuses enrolment when the invoice status is %p',
    (status) => {
      expect(() => assertOfferFeeInvoicePaid(status)).toThrow(BusinessRuleError);
    },
  );
});

/**
 * PRC-H079: the real gateway hooks with an injected fees reader. The reader only exposes
 * getInvoice, so a regression that re-adds a "record a sandbox payment" branch would fail
 * to type-check, and an unpaid invoice with any client paymentRef must still be refused.
 */
describe('assertOfferFeePaidHook (PRC-H079)', () => {
  const invoice = (status: string) => ({
    id: 'inv-1',
    tenantId: 't-1',
    studentId: 's-1',
    planId: null,
    title: 'Admission offer fee',
    description: 'Admission application app-1',
    amountCents: 1000,
    currency: 'INR',
    status,
    dueAt: null,
    createdBy: 'admissions-offer',
    createdAt: new Date(),
    updatedAt: new Date(),
    invoiceNumber: null,
    structureId: null,
  });
  const readerFor = (status: string) => {
    const getInvoice = vi.fn(async () => invoice(status) as never);
    return { getInvoice, factory: () => ({ getInvoice }) };
  };

  it('refuses an open invoice even when the client sends a paymentRef', async () => {
    const r = readerFor('open');
    const hook = assertOfferFeePaidHook(r.factory);
    await expect(
      hook({ tenantId: 't-1', invoiceId: 'inv-1', paymentRef: 'SANDBOX-PAY' }),
    ).rejects.toBeInstanceOf(BusinessRuleError);
    expect(r.getInvoice).toHaveBeenCalledWith('t-1', 'inv-1');
  });

  it('passes a paid invoice', async () => {
    const r = readerFor('paid');
    await expect(
      assertOfferFeePaidHook(r.factory)({ tenantId: 't-1', invoiceId: 'inv-1' }),
    ).resolves.toBeUndefined();
  });

  it('propagates a missing invoice instead of passing', async () => {
    const hook = assertOfferFeePaidHook(() => ({
      getInvoice: async () => {
        throw new Error('not found');
      },
    }));
    await expect(hook({ tenantId: 't-1', invoiceId: 'missing' })).rejects.toThrow('not found');
  });
});

describe('verifyOfferFeeInvoiceOwnershipHook (PRC-H079)', () => {
  const base = {
    id: 'inv-1',
    tenantId: 't-1',
    studentId: 's-1',
    planId: null,
    title: 'Admission offer fee',
    description: 'Admission application app-1',
    amountCents: 1000,
    currency: 'INR',
    status: 'paid',
    dueAt: null,
    createdBy: 'admissions-offer',
    createdAt: new Date(),
    updatedAt: new Date(),
    invoiceNumber: null,
    structureId: null,
  };
  const hookWith = (overrides: Record<string, unknown> | Error) =>
    verifyOfferFeeInvoiceOwnershipHook(() => ({
      getInvoice: async () => {
        if (overrides instanceof Error) throw overrides;
        return { ...base, ...overrides } as never;
      },
    }));
  const input = { tenantId: 't-1', applicationId: 'app-1', invoiceId: 'inv-1' };

  it("accepts the application's own offer-fee invoice", async () => {
    await expect(hookWith({})(input)).resolves.toBe(true);
  });

  it.each([
    ['another application', { description: 'Admission application app-2' }],
    ['a tuition invoice', { createdBy: 'bursar-1' }],
    ['another tenant', { tenantId: 't-2' }],
    ['a void invoice', { status: 'void' }],
    ['a written-off invoice', { status: 'written_off' }],
  ])('rejects %s', async (_label, overrides) => {
    await expect(hookWith(overrides)(input)).resolves.toBe(false);
  });

  it('rejects an unknown / cross-tenant invoice (404)', async () => {
    await expect(hookWith(new Error('not found'))(input)).resolves.toBe(false);
  });
});

describe('assertOfferFeeInvoiceMatchesOffer (PRC-M327)', () => {
  const APP = '11111111-1111-4111-8111-111111111111';
  const good = {
    createdBy: 'admissions-offer',
    description: `Admission application ${APP}`,
    amountCents: 150000,
    currency: 'INR',
  };
  const offer = { applicationId: APP, expectedAmount: 1500, expectedCurrency: 'INR' };
  it('accepts the matching admissions invoice', () => {
    expect(() => assertOfferFeeInvoiceMatchesOffer(good, offer)).not.toThrow();
  });
  it.each([
    ['foreign application', { ...good, description: 'Admission application other' }],
    ['non-admissions invoice', { ...good, createdBy: 'staff' }],
    ['cheaper amount', { ...good, amountCents: 100 }],
    ['other currency', { ...good, currency: 'USD' }],
  ])('rejects %s', (_label, invoice) => {
    expect(() => assertOfferFeeInvoiceMatchesOffer(invoice, offer)).toThrow(/does not match/);
  });
});
