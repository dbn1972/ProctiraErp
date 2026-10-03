/**
 * PRC-M082: report results carry student names; CSV export goes through the
 * audited POST /attendance/reports/export and is built server-side.
 */
import { beforeEach, describe, expect, it, vi } from 'vitest';

const m = vi.hoisted(() => ({
  calculateAttendancePercentage: vi.fn(),
  exportAttendanceReport: vi.fn(),
  withStudentLabels: vi.fn(),
}));
vi.mock('next/cache', () => ({ revalidatePath: vi.fn() }));
vi.mock('@/lib/api/gateway', () => ({ GatewayError: class extends Error {} }));
vi.mock('@/lib/api/attendance', () => ({
  calculateAttendancePercentage: m.calculateAttendancePercentage,
  exportAttendanceReport: m.exportAttendanceReport,
  createLeaveRequest: vi.fn(),
  createRegularisation: vi.fn(),
  decideLeaveRequest: vi.fn(),
  decideRegularisation: vi.fn(),
  recordBulkAttendance: vi.fn(),
}));
vi.mock('@/lib/load-entity-labels', () => ({ withStudentLabels: m.withStudentLabels }));

import { exportAttendanceReportAction, getAttendanceReportAction } from './actions';

const CLASS = '22222222-2222-4222-8222-222222222222';
const report = {
  scope: 'class',
  totalRecords: 1,
  presentCount: 1,
  absentCount: 0,
  excusedCount: 0,
  lateCount: 0,
  attendancePercentage: 100,
  absencePercentage: 0,
  studentRows: [
    {
      studentId: 's-1',
      totalRecords: 1,
      presentCount: 1,
      absentCount: 0,
      lateCount: 0,
      excusedCount: 0,
      earlyDepartureCount: 0,
      attendancePercentage: 100,
    },
  ],
};
const values = {
  scope: 'class' as const,
  institutionId: '',
  classId: CLASS,
  studentId: '',
  startDate: '2024-01-01',
  endDate: '2024-01-31',
};

describe('attendance report actions (PRC-M082)', () => {
  beforeEach(() => {
    m.withStudentLabels.mockResolvedValue(new Map([['s-1', 'Asha Rao']]));
  });

  it('returns names for per-student rows', async () => {
    m.calculateAttendancePercentage.mockResolvedValue(report);
    const res = await getAttendanceReportAction(values);
    expect(res.status).toBe('success');
    expect(res.data?.studentLabels).toEqual({ 's-1': 'Asha Rao' });
  });

  it('exports through the audited POST and builds a named CSV', async () => {
    m.exportAttendanceReport.mockResolvedValue(report);
    const res = await exportAttendanceReportAction(values, 'NHS · 10A');
    expect(m.exportAttendanceReport).toHaveBeenCalledWith(
      expect.objectContaining({ scope: 'class', classId: CLASS }),
    );
    expect(res.status).toBe('success');
    expect(res.data?.filename).toBe('attendance-class-2024-01-01-2024-01-31.csv');
    expect(res.data?.csv).toContain('Asha Rao,s-1');
  });

  it('rejects invalid filters before calling the gateway', async () => {
    m.exportAttendanceReport.mockClear();
    const res = await exportAttendanceReportAction({ ...values, endDate: '2023-01-01' }, 'x');
    expect(res.status).toBe('error');
    expect(m.exportAttendanceReport).not.toHaveBeenCalled();
  });
});
