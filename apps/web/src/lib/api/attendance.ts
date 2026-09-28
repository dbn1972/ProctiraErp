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
import { fetchList, type ListResult } from './list-result';

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

/**
 * UX AT-3 — the roster read reports *why* it is empty.
 *
 * This discarded `status` and `error` and returned `[]`, so a teacher without `attendance.read`
 * on the class saw "No roster yet. Choose an institution, class, academic period, and date…" —
 * indistinguishable from a class with no students, on the screen a teacher opens every period.
 *
 * Attendance is the highest-frequency journey in the product, so the cost of the wrong answer
 * here is paid many times a day: the teacher re-picks the class, assumes the roster is not
 * enrolled yet, and files a data problem instead of an access request.
 */
export async function getClassRoster(
  classId: string,
  academicPeriodId: string,
  date: string,
): Promise<ListResult<RosterEntry>> {
  const params = new URLSearchParams({ classId, academicPeriodId, date });
  return fetchList<RosterEntry>(`/attendance/roster?${params.toString()}`, {
    next: { revalidate: 0 },
  });
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

/**
 * UX AT-3 — a denied approval queue is not an empty one.
 *
 * "No regularisation requests yet." on a 403 reads to a clerk as "nothing to approve", which is
 * the most costly possible misreading of an approval queue.
 */
export async function listRegularisations(): Promise<ListResult<RegularisationRequest>> {
  return fetchList<RegularisationRequest>('/attendance/regularisation', {
    next: { revalidate: 0 },
  });
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

/** UX AT-3 — same reasoning as {@link listRegularisations}: a denied queue is not an empty one. */
export async function listLeaveRequests(): Promise<ListResult<LeaveRequest>> {
  return fetchList<LeaveRequest>('/attendance/leave-requests', { next: { revalidate: 0 } });
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
