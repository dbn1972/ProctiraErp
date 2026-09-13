import { describe, expect, it } from 'vitest';

import { assertBillingAccess, hasBillingAccess } from './billing-access.js';

describe('billing-access (W1-SEC-02 D1)', () => {
  it('allows platform administrators', () => {
    expect(hasBillingAccess(['platform_admin'], 'billing.manage')).toBe(true);
    expect(hasBillingAccess(['super-admin'], 'billing.read')).toBe(true);
  });

  it('denies tenant admin and school staff', () => {
    expect(hasBillingAccess(['admin'], 'billing.read')).toBe(false);
    expect(hasBillingAccess(['teacher'], 'billing.manage')).toBe(false);
    expect(hasBillingAccess([], 'billing.read')).toBe(false);
    expect(() => assertBillingAccess(['admin'], 'billing.manage')).toThrow(/Forbidden/);
  });
});
