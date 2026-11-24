/**
 * D2 CORRECTION (PRC-M015): platform_admin is the cross-tenant control-plane operator and
 * holds no tenant guardian consent, family fee or guardian messaging staff access.
 * system_admin, the per-tenant admin, keeps all three.
 *
 * Failing-first: fails while platform_admin is in the three ADMIN_ROLES lists, passes once
 * it is removed.
 */
import { describe, expect, it } from 'vitest';
import { isConsentStaff } from './parent-portal-consent-access.js';
import { isFeesStaff } from './parent-portal-fees-access.js';
import { deriveSenderRole, isMessagingStaff } from './parent-portal-messaging-access.js';
const CHECKS = [isConsentStaff, isFeesStaff, isMessagingStaff];
describe('parent-portal access tenant isolation (D2 CORRECTION)', () => {
  it('platform_admin is DENIED consent, fees and messaging staff; system_admin keeps them', () => {
    for (const check of CHECKS) {
      expect(check(['platform_admin']), check.name).toBe(false);
      expect(check(['system_admin']), check.name).toBe(true);
    }
  });
  it('platform_admin cannot post to a guardian thread as staff', () => {
    expect(deriveSenderRole(['platform_admin'])).toBe('parent');
  });
});
