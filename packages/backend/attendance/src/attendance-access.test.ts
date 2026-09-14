/**
 * W1-SEC-02 — attendance domain RBAC unit tests.
 */
import { describe, expect, it } from 'vitest';

import {
  assertAttendanceAccess,
  hasAttendanceAccess,
  normalizeAttendanceRoles,
} from './attendance-access.js';

describe('attendance-access (W1-SEC-02)', () => {
  it('normalizes string and object roles', () => {
    expect(normalizeAttendanceRoles(['Teacher', { roleName: 'Attendance_Officer' }])).toEqual([
      'teacher',
      'attendance_officer',
    ]);
  });

  it('allows teachers to write and officers to approve', () => {
    expect(hasAttendanceAccess(['teacher'], 'attendance.write')).toBe(true);
    expect(hasAttendanceAccess(['attendance_officer'], 'attendance.approve')).toBe(true);
    expect(hasAttendanceAccess(['admin'], 'attendance.read')).toBe(true);
  });

  it('denies parents/empty roles and teacher approve (fail closed)', () => {
    expect(hasAttendanceAccess(['parent'], 'attendance.write')).toBe(false);
    expect(hasAttendanceAccess(['teacher'], 'attendance.approve')).toBe(false);
    expect(hasAttendanceAccess([], 'attendance.write')).toBe(false);
    expect(() => assertAttendanceAccess(['viewer'], 'attendance.write')).toThrow(/Forbidden/);
  });
});
