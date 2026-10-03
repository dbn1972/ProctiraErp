/**
 * PRC-M082: the audited report export is a POST but only needs read access.
 */
import { describe, expect, it } from 'vitest';
import { attendanceActionForRequest } from './attendance-http-guard.js';

describe('attendanceActionForRequest', () => {
  it('maps POST /reports/export to attendance.read', () => {
    expect(attendanceActionForRequest('POST', '/attendance/reports/export')).toBe(
      'attendance.read',
    );
  });
  it('keeps other POSTs as attendance.write', () => {
    expect(attendanceActionForRequest('POST', '/attendance/student')).toBe('attendance.write');
    expect(attendanceActionForRequest('POST', '/attendance/reports/export/extra')).toBe(
      'attendance.write',
    );
  });
});
