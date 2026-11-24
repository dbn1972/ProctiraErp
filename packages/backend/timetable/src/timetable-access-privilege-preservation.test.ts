/**
 * D2 role-catalogue normalization (PRC-M015, PRC-L174) — timetable privilege-preservation.
 *
 * D2 CORRECTION: platform_admin (cross-tenant control-plane operator) is NOT in ADMIN_ROLES,
 * so it gets no tenant timetable data. system_admin (per-tenant admin) keeps every action.
 * Fails while platform_admin is in ADMIN_ROLES.
 */
import { describe, expect, it } from 'vitest';

import { hasTimetableAccess, type TimetableAction } from './timetable-access.js';

const ALL_ACTIONS: TimetableAction[] = ['schedule.write', 'schedule.publish', 'schedule.read'];

describe('timetable-access privilege preservation (D2)', () => {
  it('denies platform_admin (tenant isolation) and keeps system_admin for every action', () => {
    for (const action of ALL_ACTIONS) {
      expect(hasTimetableAccess(['platform_admin'], action), `platform_admin -> ${action}`).toBe(
        false,
      );
      expect(hasTimetableAccess(['system_admin'], action), `system_admin -> ${action}`).toBe(true);
    }
  });

  it('every previously-admitted scheduler/admin role still has write + publish', () => {
    for (const role of ['registrar', 'timetable_officer', 'admin', 'principal']) {
      expect(hasTimetableAccess([role], 'schedule.write'), role).toBe(true);
      expect(hasTimetableAccess([role], 'schedule.publish'), role).toBe(true);
    }
  });

  it('student/parent/guardian remain denied schedule.read (fail-closed unchanged)', () => {
    expect(hasTimetableAccess(['student'], 'schedule.read')).toBe(false);
    expect(hasTimetableAccess(['parent'], 'schedule.read')).toBe(false);
    expect(hasTimetableAccess(['guardian'], 'schedule.read')).toBe(false);
  });
});
