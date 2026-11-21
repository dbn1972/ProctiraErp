/**
 * D2 CORRECTION (PRC-M015) — per-student attendance tenant-isolation proof.
 *
 * platform_admin (cross-tenant control-plane operator) was wrongly added to the attendance
 * ADMIN_ROLES tier, granting it read / write / approve of a tenant's per-student attendance
 * records. The correction removes it; system_admin (per-tenant admin) is unchanged.
 *
 * Failing-first: these assertions FAIL against the pre-correction over-grant and PASS after
 * platform_admin is removed.
 */
import { describe, expect, it } from 'vitest';

import { hasAttendanceAccess, type AttendanceAction } from './attendance-access.js';

const ACTIONS: AttendanceAction[] = ['attendance.read', 'attendance.write', 'attendance.approve'];

describe('attendance-access tenant isolation (D2 CORRECTION)', () => {
  it('platform_admin is DENIED every attendance action; system_admin keeps them', () => {
    for (const action of ACTIONS) {
      expect(hasAttendanceAccess(['platform_admin'], action), action).toBe(false);
      expect(hasAttendanceAccess(['system_admin'], action), action).toBe(true);
    }
  });
});
