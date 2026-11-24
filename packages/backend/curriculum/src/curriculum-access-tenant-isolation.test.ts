/**
 * D2 CORRECTION (PRC-M015): platform_admin is the cross-tenant control-plane operator and
 * holds no tenant curriculum (academic) access. system_admin, the per-tenant admin, keeps it.
 *
 * Failing-first: fails while platform_admin is in ADMIN_ROLES, passes once it is removed.
 */
import { describe, expect, it } from 'vitest';
import { hasCurriculumAccess, hasInstitutionWideCurriculumRole } from './curriculum-access.js';
describe('curriculum-access tenant isolation (D2 CORRECTION)', () => {
  it('platform_admin is DENIED curriculum read/write; system_admin keeps them', () => {
    for (const action of ['curriculum.read', 'curriculum.write'] as const) {
      expect(hasCurriculumAccess(['platform_admin'], action), action).toBe(false);
      expect(hasCurriculumAccess(['system_admin'], action), action).toBe(true);
    }
  });
  it('platform_admin is not an institution-wide curriculum writer; system_admin is', () => {
    expect(hasInstitutionWideCurriculumRole([{ roleId: 'platform_admin' }])).toBe(false);
    expect(hasInstitutionWideCurriculumRole([{ roleId: 'system_admin' }])).toBe(true);
  });
});
