import { describe, expect, it } from 'vitest';

import { assertFeesAccess, hasFeesAccess } from './fees-access.js';

describe('fees-access (W1-SEC-02 D1)', () => {
  it('allows finance roles to read and write fees', () => {
    expect(hasFeesAccess(['bursar'], 'fees.read')).toBe(true);
    expect(hasFeesAccess([{ roleName: 'FINANCE_OFFICER' }], 'fees.write')).toBe(true);
    expect(hasFeesAccess(['registrar'], 'invoice.void')).toBe(false);
    expect(hasFeesAccess(['registrar'], 'fees.write')).toBe(true);
  });

  it('allows parents to pay and read self-scope only', () => {
    expect(hasFeesAccess(['parent'], 'payment.record')).toBe(true);
    expect(hasFeesAccess(['parent'], 'fees.read.self')).toBe(true);
    expect(hasFeesAccess(['parent'], 'fees.read')).toBe(false);
    expect(hasFeesAccess(['guardian'], 'fees.read.self')).toBe(true);
  });

  it('denies teacher / viewer mutations and staff reads', () => {
    expect(hasFeesAccess(['teacher'], 'payment.record')).toBe(false);
    expect(hasFeesAccess(['teacher'], 'fees.write')).toBe(false);
    expect(hasFeesAccess(['teacher'], 'fees.read')).toBe(false);
    expect(hasFeesAccess(['viewer'], 'fees.read')).toBe(false);
    expect(hasFeesAccess([], 'payment.record')).toBe(false);
    expect(() => assertFeesAccess(['teacher'], 'fees.write')).toThrow(/Forbidden/);
    expect(() => assertFeesAccess(['teacher'], 'fees.read')).toThrow(/Forbidden/);
  });
});
