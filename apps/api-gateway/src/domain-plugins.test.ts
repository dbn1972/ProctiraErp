/**
 * PRC-C002 regression guard: the admission offer-fee decision must never treat anything other
 * than a genuinely paid invoice as proof of payment. This tests the real decision function used
 * by assertOfferFeePaidHook (not an injected fake), so a revert to the old
 * "any paymentRef settles" behaviour is caught here.
 */
import { BusinessRuleError } from '@proctira/common';
import { describe, expect, it } from 'vitest';

import { assertOfferFeeInvoicePaid } from './domain-plugins.js';

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
