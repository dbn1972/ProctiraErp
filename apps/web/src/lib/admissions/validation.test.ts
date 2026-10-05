import { describe, expect, it } from 'vitest';
import {
  acceptOfferFormSchema,
  createEnquiryFormSchema,
  createOfferFormSchema,
} from './validation';

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

const ids = {
  institutionId: '11111111-1111-4111-8111-111111111111',
  academicPeriodId: '22222222-2222-4222-8222-222222222222',
  gradeId: '33333333-3333-4333-8333-333333333333',
};
const base = {
  ...ids,
  firstName: 'Asha',
  lastName: 'Rao',
  dateOfBirth: '2015-04-12',
  guardianName: 'Guardian',
  guardianPhone: '9876543210',
};

describe('PRC-M149 admissions form schemas', () => {
  it('blank scores become undefined, not 0', () => {
    const parsed = createEnquiryFormSchema.parse({ ...base, interviewScore: '', testScore: '' });
    expect(parsed.interviewScore).toBeUndefined();
    expect(parsed.testScore).toBeUndefined();
  });

  it('rejects impossible and future dates of birth', () => {
    expect(createEnquiryFormSchema.safeParse({ ...base, dateOfBirth: '2026-99-99' }).success).toBe(
      false,
    );
    expect(createEnquiryFormSchema.safeParse({ ...base, dateOfBirth: '2015-02-30' }).success).toBe(
      false,
    );
    const future = new Date(Date.now() + 86_400_000 * 10).toISOString().slice(0, 10);
    expect(createEnquiryFormSchema.safeParse({ ...base, dateOfBirth: future }).success).toBe(false);
    expect(createEnquiryFormSchema.safeParse({ ...base, dateOfBirth: '1900-01-01' }).success).toBe(
      false,
    );
  });

  it('validates guardian phone as E.164 or Indian mobile', () => {
    expect(createEnquiryFormSchema.safeParse({ ...base, guardianPhone: 'abc' }).success).toBe(
      false,
    );
    expect(createEnquiryFormSchema.safeParse({ ...base, guardianPhone: '12345' }).success).toBe(
      false,
    );
    expect(
      createEnquiryFormSchema.safeParse({ ...base, guardianPhone: '+91 98765-43210' }).success,
    ).toBe(true);
  });

  it('rejects fee amounts with more than 2 dp or above the bound; blank is undefined', () => {
    const offer = { applicationId: ids.institutionId, classId: ids.gradeId };
    expect(createOfferFormSchema.safeParse({ ...offer, feeAmount: '10.005' }).success).toBe(false);
    expect(createOfferFormSchema.safeParse({ ...offer, feeAmount: 1e12 }).success).toBe(false);
    expect(createOfferFormSchema.parse({ ...offer, feeAmount: '10.25' }).feeAmount).toBe(10.25);
    expect(createOfferFormSchema.parse({ ...offer, feeAmount: '' }).feeAmount).toBeUndefined();
  });
});
