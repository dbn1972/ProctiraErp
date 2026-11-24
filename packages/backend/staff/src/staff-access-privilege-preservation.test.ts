/**
 * D2 role-catalogue normalization (PRC-M015) — staff module privilege-preservation proof.
 *
 * D2 CORRECTION (PRC-M015): platform_admin (cross-tenant control-plane operator) is NOT in
 * ADMIN_ROLES, so it gets no tenant HR/staff records. system_admin (per-tenant admin) keeps
 * every grant. Fails while platform_admin is in ADMIN_ROLES.
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
  it('denies platform_admin (tenant isolation) and keeps system_admin for every action', () => {
    for (const action of ALL_ACTIONS) {
      expect(hasStaffAccess(['platform_admin'], action), `platform_admin -> ${action}`).toBe(false);
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
