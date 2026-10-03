import { describe, expect, it } from 'vitest';
import { acceptOfferFormSchema } from './validation';

const offerId = '00000000-0000-4000-8000-000000000001';

describe('acceptOfferFormSchema (PRC-H079)', () => {
  it('does not require a payment reference (it is never payment proof)', () => {
    const parsed = acceptOfferFormSchema.parse({ offerId, paymentRef: '' });
    expect(parsed.paymentRef).toBeUndefined();
    expect(acceptOfferFormSchema.parse({ offerId }).paymentRef).toBeUndefined();
  });

  it('keeps an informational reference trimmed', () => {
    expect(acceptOfferFormSchema.parse({ offerId, paymentRef: ' UTR-1 ' }).paymentRef).toBe(
      'UTR-1',
    );
  });

  it('bounds the reference length', () => {
    expect(acceptOfferFormSchema.safeParse({ offerId, paymentRef: 'x'.repeat(101) }).success).toBe(
      false,
    );
  });
});
