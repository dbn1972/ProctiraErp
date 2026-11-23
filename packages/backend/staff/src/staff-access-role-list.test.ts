/**
 * PRC-L364: the staff-access role lists name each role once, and the HR
 * writer set matches the approved D2 catalogue (registrar and
 * admissions_officer hold staff:manage) while teachers stay out.
 */
import { describe, expect, it } from 'vitest';

import { hasStaffAccess, staffActionRoles, type StaffAction } from './staff-access.js';

const ACTIONS: StaffAction[] = [
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

describe('staff-access role lists (PRC-L364)', () => {
  it.each(ACTIONS)('%s lists every role once', (action) => {
    const roles = staffActionRoles(action);
    expect(new Set(roles).size).toBe(roles.length);
  });

  it('HR writers are the D2 staff:manage holders plus admin-tier roles', () => {
    for (const role of [
      'hr_officer',
      'staff_admin',
      'registrar',
      'admissions_officer',
      'school_admin',
      'principal',
      'admin',
    ]) {
      expect(hasStaffAccess([role], 'staff.hr.write'), role).toBe(true);
    }
    for (const role of ['teacher', 'staff', 'bursar', 'finance_officer', 'parent']) {
      expect(hasStaffAccess([role], 'staff.hr.write'), role).toBe(false);
    }
  });
});
