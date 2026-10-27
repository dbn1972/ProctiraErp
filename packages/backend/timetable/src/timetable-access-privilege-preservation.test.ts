/**
 * D2 role-catalogue normalization (PRC-M015, PRC-L174) — timetable privilege-preservation.
 *
 * Only change: system_admin -> platform_admin ADD in ADMIN_ROLES. Proves platform_admin is now
 * admitted for every timetable action and system_admin retains its grants.
 */
import { describe, expect, it } from 'vitest';

import { hasTimetableAccess, type TimetableAction } from './timetable-access.js';

const ALL_ACTIONS: TimetableAction[] = ['schedule.write', 'schedule.publish', 'schedule.read'];

describe('timetable-access privilege preservation (D2)', () => {
  it('admits platform_admin alongside system_admin for every action', () => {
    for (const action of ALL_ACTIONS) {
      expect(hasTimetableAccess(['platform_admin'], action), `platform_admin -> ${action}`).toBe(
        true,
      );
      expect(hasTimetableAccess(['system_admin'], action), `system_admin -> ${action}`).toBe(true);
    }
  });

  it('every previously-admitted scheduler/admin role still has write + publish', () => {
    for (const role of ['registrar', 'scheduler', 'timetable_officer', 'admin', 'principal']) {
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
