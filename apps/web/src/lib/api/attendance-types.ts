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

export interface AttendancePercentageResult {
  studentId: string;
  percentage: number;
  presentDays: number;
  totalDays: number;
}

export interface BulkAttendanceResponse {
  created: number;
  updated: number;
  errors?: Array<{ studentId: string; message: string }>;
}
