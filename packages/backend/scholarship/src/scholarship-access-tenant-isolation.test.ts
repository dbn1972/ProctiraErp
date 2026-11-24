/**
 * D2 CORRECTION (PRC-M015): platform_admin is the cross-tenant control-plane operator and
 * holds no tenant scholarship (applications, need data, disbursements) access. system_admin,
 * the per-tenant admin, keeps every action.
 *
 * Failing-first: fails while platform_admin is in ADMIN_ROLES, passes once it is removed.
 */
import { describe, expect, it } from 'vitest';
import { hasScholarshipAccess, type ScholarshipAction } from './scholarship-access.js';
const ACTIONS: ScholarshipAction[] = [
  'scholarship.read',
  'program.write',
  'application.submit',
  'application.decide',
  'disbursement.manage',
  'compliance.record',
];
describe('scholarship-access tenant isolation (D2 CORRECTION)', () => {
  it('platform_admin is DENIED every scholarship action; system_admin keeps them', () => {
    for (const action of ACTIONS) {
      expect(hasScholarshipAccess(['platform_admin'], action), action).toBe(false);
      expect(hasScholarshipAccess(['system_admin'], action), action).toBe(true);
    }
  });
});
