/**
 * PRC-C002 regression guard: the admission offer-fee decision must never treat anything other
 * than a genuinely paid invoice as proof of payment. This tests the real decision function used
 * by assertOfferFeePaidHook (not an injected fake), so a revert to the old
 * "any paymentRef settles" behaviour is caught here.
 */
import { BusinessRuleError } from '@proctira/common';
import { describe, expect, it } from 'vitest';

import { assertOfferFeeInvoiceMatchesOffer, assertOfferFeeInvoicePaid } from './domain-plugins.js';

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
