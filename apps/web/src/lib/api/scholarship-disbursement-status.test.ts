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
    expect(mapDisbursement({ id: 'd1', paymentStatus }).status).toBe(expected);
  });
});

describe('totalsByCurrency (PRC-M111)', () => {
  it('never sums across currencies', () => {
    expect(
      totalsByCurrency([
        { amount: 100, currency: 'INR' },
        { amount: 50, currency: 'USD' },
        { amount: 25, currency: 'INR' },
      ]),
    ).toEqual([
      { currency: 'INR', total: 125 },
      { currency: 'USD', total: 50 },
    ]);
  });
});
