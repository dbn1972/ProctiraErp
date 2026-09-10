import { describe, expect, it } from 'vitest';

import { assertFeesAccess, hasFeesAccess } from './fees-access.js';

describe('fees-access (PRD-005)', () => {
  it('allows finance roles to record payments', () => {
    expect(hasFeesAccess(['bursar'], 'payment.record')).toBe(true);
    expect(hasFeesAccess([{ roleName: 'FINANCE_OFFICER' }], 'payment.record')).toBe(true);
    expect(hasFeesAccess(['parent'], 'payment.record')).toBe(true);
  });

  it('denies teacher / viewer payment posts', () => {
    expect(hasFeesAccess(['teacher'], 'payment.record')).toBe(false);
    expect(hasFeesAccess(['viewer'], 'payment.record')).toBe(false);
    expect(hasFeesAccess([], 'payment.record')).toBe(false);
    expect(() => assertFeesAccess(['teacher'], 'payment.record')).toThrow(/Forbidden/);
  });
});
