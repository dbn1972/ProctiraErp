/** PRC-M082: server-built attendance CSV carries names and neutralises formulas. */
import { describe, expect, it } from 'vitest';
import { toAttendanceReportCsv } from './report-csv';

const result = {
  scope: 'class',
  totalRecords: 2,
  presentCount: 1,
  absentCount: 1,
  excusedCount: 0,
  lateCount: 0,
  attendancePercentage: 50,
  absencePercentage: 50,
  studentRows: [
    {
      studentId: 's-1',
      totalRecords: 2,
      presentCount: 1,
      absentCount: 1,
      lateCount: 0,
      excusedCount: 0,
      earlyDepartureCount: 0,
      attendancePercentage: 50,
    },
    {
      studentId: 's-2',
      totalRecords: 0,
      presentCount: 0,
      absentCount: 0,
      lateCount: 0,
      excusedCount: 0,
      earlyDepartureCount: 0,
      attendancePercentage: 0,
    },
  ],
};

describe('toAttendanceReportCsv', () => {
  it('includes student names and the scope name', () => {
    const csv = toAttendanceReportCsv(
      result,
      { startDate: '2024-01-01', endDate: '2024-01-31' },
      'NHS · 10A',
      new Map([['s-1', '=HYPERLINK("x") Asha']]),
    );
    expect(csv).toContain('scope_name,NHS · 10A');
    expect(csv).toContain('student_name,student_id');
    // Formula prefix neutralised and quoted.
    expect(csv).toContain(`"'=HYPERLINK(""x"") Asha",s-1`);
    expect(csv).toContain('Unknown student,s-2');
  });
});
