/**
 * D2 role-catalogue normalization (PRC-M015, PRC-L276) — registration privilege-preservation.
 *
 * Only change: system_admin -> platform_admin ADD in ADMIN_ROLES. Proves platform_admin is now
 * admitted for every registration/admissions staff action and system_admin retains its grants.
 */
import { describe, expect, it } from 'vitest';

import { hasRegistrationAccess, type RegistrationAction } from './registration-access.js';

const ALL_ACTIONS: RegistrationAction[] = [
  'registration.staff.read',
  'registration.staff.write',
  'admissions.staff.read',
  'admissions.staff.write',
];

describe('registration-access privilege preservation (D2)', () => {
  it('admits platform_admin alongside system_admin for every action', () => {
    for (const action of ALL_ACTIONS) {
      expect(hasRegistrationAccess(['platform_admin'], action), `platform_admin -> ${action}`).toBe(
        true,
      );
      expect(hasRegistrationAccess(['system_admin'], action), `system_admin -> ${action}`).toBe(
        true,
      );
    }
  });

  it('every previously-admitted staff/admin role still has every action', () => {
    for (const role of ['registrar', 'admissions_officer', 'admin', 'super-admin', 'principal']) {
      for (const action of ALL_ACTIONS) {
        expect(hasRegistrationAccess([role], action), `${role} -> ${action}`).toBe(true);
      }
    }
  });

  it('a portal role remains denied (fail-closed unchanged)', () => {
    expect(hasRegistrationAccess(['parent'], 'admissions.staff.read')).toBe(false);
    expect(hasRegistrationAccess(['student'], 'registration.staff.write')).toBe(false);
  });
});
