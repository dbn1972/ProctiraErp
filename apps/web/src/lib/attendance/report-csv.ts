/**
 * Attendance report CSV (G-925, PRC-M082). Built server-side by the audited
 * export action; includes student names instead of raw ids only.
 */
import type { AttendancePercentageResult } from '@/lib/api/attendance';

/** Quote + neutralise spreadsheet formula injection. */
function cell(value: string | number): string {
  let str = String(value);
  if (/^[=+\-@\t\r]/.test(str)) str = `'${str}`;
  return /[",\n']/.test(str) ? `"${str.replace(/"/g, '""')}"` : str;
}

export function toAttendanceReportCsv(
  result: AttendancePercentageResult,
  range: { startDate: string; endDate: string },
  scopeLabel: string,
  studentLabels: Map<string, string>,
): string {
  const rows: Array<[string, string | number]> = [
    ['scope', result.scope],
    ['scope_name', scopeLabel],
    ['start_date', range.startDate],
    ['end_date', range.endDate],
    ['total_records', result.totalRecords],
    ['present', result.presentCount],
    ['absent', result.absentCount],
    ['late', result.lateCount],
    ['early_departure', result.earlyDepartureCount ?? 0],
    ['excused', result.excusedCount],
    ['attendance_percentage', result.attendancePercentage.toFixed(2)],
    ['absence_percentage', result.absencePercentage.toFixed(2)],
  ];
  const metricCsv = `${['metric,value', ...rows.map(([k, v]) => `${k},${cell(v)}`)].join('\n')}\n`;
  const studentRows = result.studentRows ?? [];
  if (studentRows.length === 0) return metricCsv;
  const header =
    'student_name,student_id,total_records,present,absent,late,excused,early_departure,attendance_percentage';
  const lines = studentRows.map((r) =>
    [
      cell(studentLabels.get(r.studentId) ?? 'Unknown student'),
      cell(r.studentId),
      r.totalRecords,
      r.presentCount,
      r.absentCount,
      r.lateCount,
      r.excusedCount,
      r.earlyDepartureCount,
      r.attendancePercentage.toFixed(2),
    ].join(','),
  );
  return `${metricCsv}\n${[header, ...lines].join('\n')}\n`;
}
