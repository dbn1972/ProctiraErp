/**
 * D2 CORRECTION (PRC-M015): platform_admin is the cross-tenant control-plane operator and
 * holds no tenant LMS (coursework, submissions) staff access. system_admin, the per-tenant
 * admin, keeps it.
 *
 * Failing-first: fails while platform_admin is in ADMIN_ROLES, passes once it is removed.
 */
import { describe, expect, it } from 'vitest';
import { hasLmsAccess } from './lms-access.js';
describe('lms-access tenant isolation (D2 CORRECTION)', () => {
  it('platform_admin is DENIED lms.staff; system_admin keeps it', () => {
    expect(hasLmsAccess(['platform_admin'], 'lms.staff')).toBe(false);
    expect(hasLmsAccess(['system_admin'], 'lms.staff')).toBe(true);
  });
});
