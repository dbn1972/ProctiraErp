/**
 * PRC-L503: package-level RBAC coverage for timetable-access.ts, analogous to
 * attendance-http-guard.test.ts. Asserts hasTimetableAccess/assertTimetableAccess reject every
 * non-staff role for schedule.write/schedule.publish, and non-scheduler staff roles (teacher
 * should read but not write) for schedule.write specifically.
 */
import { describe, expect, it } from 'vitest';
import { assertTimetableAccess, hasTimetableAccess } from './timetable-access.js';

const NON_STAFF_ROLES = ['student', 'parent', 'guardian', 'alumni', 'unknown_role'];
const SCHEDULER_ROLES = [
  'registrar',
  'scheduler',
  'timetable_officer',
  'admin',
  'super-admin',
  'super_admin',
  'system_admin',
  'principal',
  'school_admin',
];
const NON_SCHEDULER_STAFF_ROLES = ['teacher', 'staff', 'staff_admin', 'hod', 'coordinator'];

describe('timetable-access (PRC-L503)', () => {
  describe('schedule.write', () => {
    it.each(NON_STAFF_ROLES)('rejects non-staff role %s', (role) => {
      expect(hasTimetableAccess([role], 'schedule.write')).toBe(false);
      expect(() => assertTimetableAccess([role], 'schedule.write')).toThrow(/Forbidden/);
    });

    it.each(NON_SCHEDULER_STAFF_ROLES)('rejects non-scheduler staff role %s', (role) => {
      expect(hasTimetableAccess([role], 'schedule.write')).toBe(false);
      expect(() => assertTimetableAccess([role], 'schedule.write')).toThrow(/Forbidden/);
    });

    it.each(SCHEDULER_ROLES)('allows scheduler role %s', (role) => {
      expect(hasTimetableAccess([role], 'schedule.write')).toBe(true);
      expect(() => assertTimetableAccess([role], 'schedule.write')).not.toThrow();
    });
  });

  describe('schedule.publish', () => {
    it.each(NON_STAFF_ROLES)('rejects non-staff role %s', (role) => {
      expect(hasTimetableAccess([role], 'schedule.publish')).toBe(false);
      expect(() => assertTimetableAccess([role], 'schedule.publish')).toThrow(/Forbidden/);
    });

    it.each(NON_SCHEDULER_STAFF_ROLES)('rejects non-scheduler staff role %s', (role) => {
      expect(hasTimetableAccess([role], 'schedule.publish')).toBe(false);
    });

    it.each(SCHEDULER_ROLES)('allows scheduler role %s', (role) => {
      expect(hasTimetableAccess([role], 'schedule.publish')).toBe(true);
    });
  });

  describe('schedule.read', () => {
    it('teacher can read but not write (staff-read is broader than scheduler-write)', () => {
      expect(hasTimetableAccess(['teacher'], 'schedule.read')).toBe(true);
      expect(hasTimetableAccess(['teacher'], 'schedule.write')).toBe(false);
    });

    it.each(NON_STAFF_ROLES)('rejects non-staff role %s', (role) => {
      expect(hasTimetableAccess([role], 'schedule.read')).toBe(false);
    });
  });

  it('empty/missing roles are rejected for every action', () => {
    expect(hasTimetableAccess([], 'schedule.write')).toBe(false);
    expect(hasTimetableAccess(undefined, 'schedule.write')).toBe(false);
    expect(hasTimetableAccess(null, 'schedule.read')).toBe(false);
  });
});
