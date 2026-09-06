/** Client-safe attendance types (no server imports). */

export type StudentAttendanceStatus = 'PRESENT' | 'ABSENT' | 'LATE' | 'EXCUSED';
export type StaffAttendanceStatus = 'PRESENT' | 'ABSENT' | 'ON_LEAVE';

export interface RosterEntry {
  studentId: string;
  studentName: string;
  enrollmentId: string;
  classId: string;
  gradeId: string;
  attendance?: {
    id: string;
    status: string;
    comment: string | null;
  };
}

/** Aggregate percentage report (student / class / institution scope). */
export interface AttendancePercentageResult {
  scope: string;
  totalRecords: number;
  presentCount: number;
  absentCount: number;
  excusedCount: number;
  lateCount: number;
  attendancePercentage: number;
  absencePercentage: number;
}

export interface BulkAttendanceResponse {
  recorded: unknown[];
  updated: unknown[];
  errors: Array<{ studentId: string; message: string }>;
  summary: {
    totalRecorded: number;
    totalUpdated: number;
    totalErrors: number;
  };
}
