/** PRC-M111 — every backend disbursement status maps to its own UI status. */
import { describe, expect, it } from 'vitest';
import { mapDisbursement, totalsByCurrency } from './scholarships';

describe('mapDisbursement (PRC-M111)', () => {
  it.each([
    ['scheduled', 'SCHEDULED'],
    ['processing', 'PROCESSING'],
    ['paid', 'PROCESSED'],
    ['processed', 'PROCESSED'],
    ['failed', 'FAILED'],
    ['cancelled', 'CANCELLED'],
    ['CANCELED', 'CANCELLED'],
  ])('%s -> %s', (paymentStatus, expected) => {
    expect(mapDisbursement({ id: 'd1', paymentStatus, amountCents: 100 }).status).toBe(expected);
  });
});

describe('totalsByCurrency (PRC-M111)', () => {
  it('never sums across currencies', () => {
    expect(
      totalsByCurrency([
        { amountCents: 10_000, currency: 'INR' },
        { amountCents: 5_000, currency: 'USD' },
        { amountCents: 2_500, currency: 'INR' },
      ]),
    ).toEqual([
      { currency: 'INR', totalCents: 12_500, total: 125 },
      { currency: 'USD', totalCents: 5_000, total: 50 },
    ]);
  });
});
