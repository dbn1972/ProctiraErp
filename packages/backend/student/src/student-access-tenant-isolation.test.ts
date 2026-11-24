/**
 * D2 CORRECTION (PRC-M015) — student-PII tenant-isolation proof.
 *
 * platform_admin is the cross-tenant PLATFORM / control-plane operator; system_admin is the
 * per-TENANT administrator. The first D2 implementation wrongly added platform_admin to the
 * student READ_ROLES and ADMIN_ROLES allow-lists, granting a platform operator tenant-scoped
 * student-PII read/write and breaking tenant isolation. The correction removes it.
 *
 * Failing-first: these assertions FAIL against the pre-correction over-grant (platform_admin
 * was admitted) and PASS after platform_admin is removed. system_admin is asserted unchanged.
 */
import { describe, expect, it } from 'vitest';

import {
  hasStudentReadAccess,
  hasStudentWriteAccess,
  type StudentWriteAction,
} from './student-access.js';

const WRITE_ACTIONS: StudentWriteAction[] = ['student.create', 'student.update', 'student.delete'];

describe('student-access tenant isolation (D2 CORRECTION)', () => {
  it('platform_admin CANNOT read the tenant student roster; system_admin can', () => {
    expect(hasStudentReadAccess(['platform_admin'])).toBe(false);
    expect(hasStudentReadAccess(['system_admin'])).toBe(true);
  });

  it('platform_admin CANNOT write student PII for any action; system_admin can', () => {
    for (const action of WRITE_ACTIONS) {
      expect(hasStudentWriteAccess(['platform_admin'], action), action).toBe(false);
      expect(hasStudentWriteAccess(['system_admin'], action), action).toBe(true);
    }
  });
});
