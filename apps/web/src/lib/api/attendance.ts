/**
 * Attendance-service API client (server-side).
 *
 * Wraps the attendance-service endpoints exposed through the API gateway:
 *   /api/v1/attendance/student            (single record)
 *   /api/v1/attendance/student/bulk       (bulk class roster)
 *   /api/v1/attendance/staff              (staff record)
 *   /api/v1/attendance/roster             (class roster pre-population)
 *   /api/v1/attendance/percentage         (percentage calculation)
 *   /api/v1/attendance/config/:id         (institution config)
 */
import { gatewayFetch } from './gateway';

/* ------------------------------------------------------------------ Types */

export type StudentAttendanceStatus = 'PRESENT' | 'ABSENT' | 'LATE' | 'EXCUSED' | 'EARLY_DEPARTURE';
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

export interface AttendanceConfig {
  institutionId: string;
  recordingMode: 'class' | 'subject' | 'period';
  leaveTypes: Array<{
    id: string;
    name: string;
    code: string;
    isActive: boolean;
  }>;
}

export interface BulkAttendanceRecord {
  studentId: string;
  status: StudentAttendanceStatus;
  comment?: string;
}

export interface BulkAttendanceInput {
  institutionId: string;
  classId: string;
  academicPeriodId: string;
  date: string;
  subjectId?: string;
  periodId?: string;
  records: BulkAttendanceRecord[];
}

export interface StudentAttendanceRecord {
  id: string;
  studentId: string;
  institutionId: string;
  classId: string;
  academicPeriodId: string;
  date: string;
  subjectId: string | null;
  periodId: string | null;
  status: string;
  comment: string | null;
  recordedBy: string;
  createdAt: string;
  updatedAt: string;
}

export interface BulkAttendanceResponse {
  recorded: StudentAttendanceRecord[];
  updated: StudentAttendanceRecord[];
  errors: Array<{ studentId: string; message: string }>;
  summary: {
    totalRecorded: number;
    totalUpdated: number;
    totalErrors: number;
  };
}

export interface AttendancePercentageInput {
  scope: 'student' | 'class' | 'institution';
  studentId?: string;
  classId?: string;
  institutionId?: string;
  startDate: string;
  endDate: string;
}

export interface AttendanceStudentRow {
  studentId: string;
  totalRecords: number;
  presentCount: number;
  absentCount: number;
  lateCount: number;
  excusedCount: number;
  earlyDepartureCount: number;
  attendancePercentage: number;
}

export interface AttendancePercentageResult {
  scope: string;
  totalRecords: number;
  presentCount: number;
  absentCount: number;
  excusedCount: number;
  lateCount: number;
  earlyDepartureCount?: number;
  attendancePercentage: number;
  absencePercentage: number;
  studentRows?: AttendanceStudentRow[];
}

/* ----------------------------------------------------------------- API */

export async function getClassRoster(
  classId: string,
  academicPeriodId: string,
  date: string,
): Promise<RosterEntry[]> {
  const params = new URLSearchParams({ classId, academicPeriodId, date });
  const result = await gatewayFetch<{ data: RosterEntry[] }>(
    `/attendance/roster?${params.toString()}`,
    { method: 'GET', throwOnError: false, next: { revalidate: 0 } },
  );
  return result.ok && result.data ? (result.data.data ?? []) : [];
}

export async function getAttendanceConfig(institutionId: string): Promise<AttendanceConfig | null> {
  const result = await gatewayFetch<AttendanceConfig>(`/attendance/config/${institutionId}`, {
    method: 'GET',
    throwOnError: false,
    next: { revalidate: 60 },
  });
  return result.ok ? result.data : null;
}

export async function recordBulkAttendance(
  input: BulkAttendanceInput,
): Promise<BulkAttendanceResponse> {
  const result = await gatewayFetch<BulkAttendanceResponse>('/attendance/student/bulk', {
    method: 'POST',
    json: input,
  });
  if (!result.data) throw new Error('Empty response from attendance-service');
  return result.data;
}

export async function calculateAttendancePercentage(
  input: AttendancePercentageInput,
): Promise<AttendancePercentageResult | null> {
  const params = new URLSearchParams({
    scope: input.scope,
    startDate: input.startDate,
    endDate: input.endDate,
  });
  if (input.studentId) params.set('studentId', input.studentId);
  if (input.classId) params.set('classId', input.classId);
  if (input.institutionId) params.set('institutionId', input.institutionId);
  const result = await gatewayFetch<AttendancePercentageResult>(
    `/attendance/percentage?${params.toString()}`,
    { method: 'GET', throwOnError: false, next: { revalidate: 0 } },
  );
  return result.ok ? result.data : null;
}

export interface RegularisationRequest {
  id: string;
  attendanceId: string;
  studentId: string;
  toStatus: string;
  fromStatus: string;
  status: string;
  reason: string | null;
  attendanceDate: string;
}

export interface LeaveRequest {
  id: string;
  studentId: string;
  fromDate: string;
  toDate: string;
  status: string;
  reason: string | null;
}

export async function listRegularisations(): Promise<RegularisationRequest[]> {
  const result = await gatewayFetch<{ data: RegularisationRequest[] }>(
    '/attendance/regularisation',
    { method: 'GET', throwOnError: false, next: { revalidate: 0 } },
  );
  return result.ok && result.data ? (result.data.data ?? []) : [];
}

export async function createRegularisation(input: {
  attendanceId: string;
  studentId: string;
  institutionId: string;
  classId: string;
  attendanceDate: string;
  fromStatus: string;
  toStatus: StudentAttendanceStatus;
  reason?: string;
}): Promise<RegularisationRequest> {
  const result = await gatewayFetch<RegularisationRequest>('/attendance/regularisation', {
    method: 'POST',
    json: input,
  });
  if (!result.data) throw new Error('Empty regularisation response');
  return result.data;
}

export async function decideRegularisation(
  id: string,
  decision: 'approve' | 'reject',
  decisionNote?: string,
): Promise<RegularisationRequest> {
  const result = await gatewayFetch<RegularisationRequest>(
    `/attendance/regularisation/${encodeURIComponent(id)}/${decision}`,
    { method: 'POST', json: { decisionNote } },
  );
  if (!result.data) throw new Error('Empty regularisation decision');
  return result.data;
}

export async function listLeaveRequests(): Promise<LeaveRequest[]> {
  const result = await gatewayFetch<{ data: LeaveRequest[] }>('/attendance/leave-requests', {
    method: 'GET',
    throwOnError: false,
    next: { revalidate: 0 },
  });
  return result.ok && result.data ? (result.data.data ?? []) : [];
}

export async function createLeaveRequest(input: {
  studentId: string;
  institutionId: string;
  classId: string;
  academicPeriodId: string;
  fromDate: string;
  toDate: string;
  reason?: string;
  attachmentUrl?: string;
}): Promise<LeaveRequest> {
  const result = await gatewayFetch<LeaveRequest>('/attendance/leave-requests', {
    method: 'POST',
    json: input,
  });
  if (!result.data) throw new Error('Empty leave response');
  return result.data;
}

export async function decideLeaveRequest(
  id: string,
  decision: 'approve' | 'reject',
  decisionNote?: string,
): Promise<LeaveRequest> {
  const result = await gatewayFetch<LeaveRequest>(
    `/attendance/leave-requests/${encodeURIComponent(id)}/${decision}`,
    { method: 'POST', json: { decisionNote } },
  );
  if (!result.data) throw new Error('Empty leave decision');
  return result.data;
}
