/**
 * D2 role-catalogue normalization (PRC-M015) — staff module privilege-preservation proof.
 *
 * Only change here: system_admin -> platform_admin ADD in ADMIN_ROLES. Proves platform_admin
 * is now admitted for every staff action and that system_admin retains every grant.
 */
import { describe, expect, it } from 'vitest';

import { hasStaffAccess, type StaffAction } from './staff-access.js';

const ALL_ACTIONS: StaffAction[] = [
  'staff.create',
  'staff.update',
  'staff.delete',
  'staff.hr.write',
  'staff.import',
  'payroll.export',
  'staff.hr.read',
  'staff.read',
  'staff.appraisal.decide',
];

describe('staff-access privilege preservation (D2)', () => {
  it('admits platform_admin for every staff action (additive with system_admin)', () => {
    for (const action of ALL_ACTIONS) {
      expect(hasStaffAccess(['platform_admin'], action), `platform_admin -> ${action}`).toBe(true);
      expect(hasStaffAccess(['system_admin'], action), `system_admin -> ${action}`).toBe(true);
    }
  });

  it('every previously-admitted admin role still has every staff action', () => {
    for (const role of ['admin', 'super-admin', 'super_admin', 'system-admin', 'principal']) {
      for (const action of ALL_ACTIONS) {
        expect(hasStaffAccess([role], action), `${role} -> ${action}`).toBe(true);
      }
    }
  });

  it('a non-staff role remains denied (fail-closed unchanged)', () => {
    expect(hasStaffAccess(['parent'], 'staff.read')).toBe(false);
    expect(hasStaffAccess(['student'], 'staff.hr.read')).toBe(false);
  });
});
