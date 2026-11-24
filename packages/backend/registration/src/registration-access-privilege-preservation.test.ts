/**
 * D2 role-catalogue normalization (PRC-M015, PRC-L276) — registration privilege-preservation.
 *
 * D2 CORRECTION (PRC-M015): platform_admin (cross-tenant control-plane operator) is NOT in
 * ADMIN_ROLES, so it gets no applicant/child PII. system_admin (per-tenant admin) keeps every
 * registration/admissions staff action. Fails while platform_admin is in ADMIN_ROLES.
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
  it('denies platform_admin (tenant isolation) and keeps system_admin for every action', () => {
    for (const action of ALL_ACTIONS) {
      expect(hasRegistrationAccess(['platform_admin'], action), `platform_admin -> ${action}`).toBe(
        false,
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
