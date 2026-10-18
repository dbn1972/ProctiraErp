/**
 * D2 CORRECTION (PRC-M015) — student-portal (students-360 PII) tenant-isolation proof.
 *
 * platform_admin (cross-tenant control-plane operator) was wrongly added to the student-portal
 * ADMIN_ROLES set, granting it the staff read / registrar-admin / medical / discipline /
 * national-id surfaces for a tenant's students. The correction removes it; system_admin (the
 * per-tenant admin) is unchanged.
 *
 * Failing-first: these assertions FAIL against the pre-correction over-grant and PASS after
 * platform_admin is removed.
 */
import { describe, expect, it } from 'vitest';

import {
  isDisciplineStaff,
  isMedicalStaff,
  isRegistrarOrAdmin,
  isStudentReadStaff,
  mayViewNationalId,
} from './student-portal-access.js';

describe('student-portal-access tenant isolation (D2 CORRECTION)', () => {
  it('platform_admin is DENIED every staff student-PII surface; system_admin keeps them', () => {
    for (const check of [
      isStudentReadStaff,
      isRegistrarOrAdmin,
      isMedicalStaff,
      isDisciplineStaff,
      mayViewNationalId,
    ]) {
      expect(check(['platform_admin']), check.name).toBe(false);
      expect(check(['system_admin']), check.name).toBe(true);
    }
  });
});
