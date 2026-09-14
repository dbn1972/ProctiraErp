/**
 * Staff-service API client (server-side).
 *
 * Wraps the staff-service endpoints exposed through the API gateway:
 *   /api/v1/staff                  (CRUD, search)
 *   /api/v1/staff/assignments      (assignment CRUD)
 *   /api/v1/staff/appraisals       (appraisal CRUD)
 *   /api/v1/staff/appraisals/templates
 *   /api/v1/staff/training/...     (training programs, sessions, certifications)
 *
 * All calls are tenant-scoped via `gatewayFetch`.
 */
import { gatewayFetch } from './gateway';

/* ------------------------------------------------------------------ Types */

export interface Staff {
  id: string;
  firstName: string;
  lastName: string;
  dateOfBirth: string;
  identityNumber: string;
  contactPhone: string;
  contactEmail: string | null;
  position: string;
  status: string;
  customData: Record<string, unknown> | null;
  createdAt: string;
  updatedAt: string;
}

export interface PaginationMeta {
  page: number;
  pageSize: number;
  totalItems: number;
  totalPages: number;
}

export interface StaffListResponse {
  data: Staff[];
  meta: PaginationMeta;
}

export interface StaffListFilters {
  page?: number;
  pageSize?: number;
  search?: string;
  position?: string;
  status?: 'ACTIVE' | 'INACTIVE' | 'ALL';
  sortBy?: 'firstName' | 'lastName' | 'position' | 'createdAt';
  sortOrder?: 'asc' | 'desc';
  /** Convenience filter forwarded to backend (currently mapped to search). */
  institutionId?: string;
}

export interface CreateStaffInput {
  firstName: string;
  lastName: string;
  dateOfBirth: string;
  identityNumber: string;
  contactPhone: string;
  contactEmail?: string;
  position: string;
  customData?: Record<string, unknown>;
}

export type UpdateStaffInput = Partial<CreateStaffInput>;

export interface Assignment {
  id: string;
  staffId: string;
  institutionId: string;
  subjectId: string;
  classId: string;
  role: string;
  allocationPercentage: number;
  startDate: string;
  endDate: string | null;
  status: string;
  createdAt: string;
  updatedAt: string;
}

export interface CreateAssignmentInput {
  staffId: string;
  institutionId: string;
  subjectId: string;
  classId: string;
  role: string;
  allocationPercentage: number;
  startDate: string;
  endDate?: string;
}

export interface AppraisalTemplate {
  id: string;
  name: string;
  description: string | null;
  academicPeriodId: string;
  criteria: Array<{
    name: string;
    description: string | null;
    weight: number;
    maxScore: number;
  }>;
  scoreMin: number;
  scoreMax: number;
  createdAt: string;
  updatedAt: string;
}

export interface Appraisal {
  id: string;
  staffId: string;
  templateId: string;
  appraisalDate: string;
  scores: Array<{
    criterionName: string;
    score: number;
    comment: string | null;
  }>;
  totalScore: number;
  overallComment: string | null;
  status: string;
  workflowInstanceId: string | null;
  createdAt: string;
  updatedAt: string;
}

export interface CreateAppraisalInput {
  staffId: string;
  templateId: string;
  appraisalDate: string;
  scores: Array<{
    criterionName: string;
    score: number;
    comment?: string;
  }>;
  overallComment?: string;
}

export interface TrainingCertification {
  id: string;
  staffId: string;
  programId: string;
  certificationName: string;
  issuedDate: string;
  expiryDate: string | null;
  status: string;
  createdAt: string;
  updatedAt: string;
}

/* ------------------------------------------------------------------- API */

function buildQuery(filters: StaffListFilters): string {
  const params = new URLSearchParams();
  if (filters.page) params.set('page', String(filters.page));
  if (filters.pageSize) params.set('pageSize', String(filters.pageSize));
  if (filters.search) params.set('search', filters.search);
  if (filters.position) params.set('position', filters.position);
  if (filters.status && filters.status !== 'ALL') params.set('status', filters.status);
  if (filters.sortBy) params.set('sortBy', filters.sortBy);
  if (filters.sortOrder) params.set('sortOrder', filters.sortOrder);
  if (filters.institutionId) params.set('institutionId', filters.institutionId);
  const qs = params.toString();
  return qs ? `?${qs}` : '';
}

export async function listStaff(filters: StaffListFilters = {}): Promise<StaffListResponse> {
  const result = await gatewayFetch<StaffListResponse>(`/staff${buildQuery(filters)}`, {
    method: 'GET',
    throwOnError: false,
    next: { revalidate: 0 },
  });
  if (!result.ok || !result.data) {
    return {
      data: [],
      meta: {
        page: filters.page ?? 1,
        pageSize: filters.pageSize ?? 20,
        totalItems: 0,
        totalPages: 0,
      },
    };
  }
  return result.data;
}

export async function getStaff(id: string): Promise<Staff | null> {
  const result = await gatewayFetch<Staff>(`/staff/${id}`, {
    method: 'GET',
    throwOnError: false,
    next: { revalidate: 0 },
  });
  return result.ok ? result.data : null;
}

export async function createStaff(input: CreateStaffInput): Promise<Staff> {
  const result = await gatewayFetch<Staff>('/staff', {
    method: 'POST',
    json: input,
  });
  if (!result.data) throw new Error('Empty response from staff-service');
  return result.data;
}

export async function updateStaff(id: string, input: UpdateStaffInput): Promise<Staff> {
  const result = await gatewayFetch<Staff>(`/staff/${id}`, {
    method: 'PUT',
    json: input,
  });
  if (!result.data) throw new Error('Empty response from staff-service');
  return result.data;
}

export async function deleteStaff(id: string): Promise<void> {
  await gatewayFetch<void>(`/staff/${id}`, { method: 'DELETE' });
}

/* ------------------------------------------------------------- Assignments */

export async function listStaffAssignments(staffId: string): Promise<Assignment[]> {
  const result = await gatewayFetch<{ data: Assignment[]; meta?: PaginationMeta }>(
    `/staff/assignments?staffId=${encodeURIComponent(staffId)}&pageSize=100`,
    { method: 'GET', throwOnError: false, next: { revalidate: 0 } },
  );
  return result.ok && result.data ? (result.data.data ?? []) : [];
}

export async function createAssignment(input: CreateAssignmentInput): Promise<Assignment> {
  const result = await gatewayFetch<Assignment>('/staff/assignments', {
    method: 'POST',
    json: input,
  });
  if (!result.data) throw new Error('Empty response from staff-service');
  return result.data;
}

/* ------------------------------------------------------------- Appraisals */

export async function listAppraisalTemplates(): Promise<AppraisalTemplate[]> {
  const result = await gatewayFetch<{ data: AppraisalTemplate[] }>(
    '/staff/appraisals/templates?pageSize=100',
    { method: 'GET', throwOnError: false, next: { revalidate: 30 } },
  );
  return result.ok && result.data ? (result.data.data ?? []) : [];
}

export async function getAppraisalTemplate(templateId: string): Promise<AppraisalTemplate | null> {
  const result = await gatewayFetch<AppraisalTemplate>(
    `/staff/appraisals/templates/${templateId}`,
    { method: 'GET', throwOnError: false, next: { revalidate: 30 } },
  );
  return result.ok ? result.data : null;
}

export async function listStaffAppraisals(staffId: string): Promise<Appraisal[]> {
  const result = await gatewayFetch<{ data: Appraisal[] }>(
    `/staff/appraisals?staffId=${encodeURIComponent(staffId)}&pageSize=100`,
    { method: 'GET', throwOnError: false, next: { revalidate: 0 } },
  );
  return result.ok && result.data ? (result.data.data ?? []) : [];
}

export async function createAppraisal(input: CreateAppraisalInput): Promise<Appraisal> {
  const result = await gatewayFetch<Appraisal>('/staff/appraisals', {
    method: 'POST',
    json: input,
  });
  if (!result.data) throw new Error('Empty response from staff-service');
  return result.data;
}

/* ------------------------------------------------------------- Training */

export async function listStaffCertifications(staffId: string): Promise<TrainingCertification[]> {
  const result = await gatewayFetch<{ data: TrainingCertification[] }>(
    `/staff/training/certifications?staffId=${encodeURIComponent(staffId)}&pageSize=100`,
    { method: 'GET', throwOnError: false, next: { revalidate: 0 } },
  );
  return result.ok && result.data ? (result.data.data ?? []) : [];
}

/* ------------------------------------------------------------- HR Leave */

export interface StaffLeave {
  id: string;
  tenantId: string;
  staffId: string;
  leaveType: string;
  startDate: string;
  endDate: string;
  reason: string | null;
  status: string;
  decidedBy: string | null;
  decidedAt: string | null;
  createdAt: string;
  updatedAt: string;
}

export interface CreateStaffLeaveInput {
  staffId: string;
  leaveType?: 'annual' | 'sick' | 'casual' | 'unpaid' | 'other';
  startDate: string;
  endDate: string;
  reason?: string;
}

export async function listStaffLeaves(): Promise<StaffLeave[]> {
  const result = await gatewayFetch<{ data: StaffLeave[] }>('/staff/leaves', {
    method: 'GET',
    throwOnError: false,
    next: { revalidate: 0 },
  });
  return result.ok && result.data ? (result.data.data ?? []) : [];
}

export async function createStaffLeave(input: CreateStaffLeaveInput): Promise<StaffLeave> {
  const result = await gatewayFetch<StaffLeave>('/staff/leaves', {
    method: 'POST',
    json: input,
  });
  if (!result.data) throw new Error('Empty response from staff-service');
  return result.data;
}

export async function decideStaffLeave(
  id: string,
  status: 'approved' | 'rejected',
): Promise<StaffLeave> {
  const result = await gatewayFetch<StaffLeave>(`/staff/leaves/${id}/decide`, {
    method: 'POST',
    json: { status },
  });
  if (!result.data) throw new Error('Empty response from staff-service');
  return result.data;
}

/* ------------------------------------------------------------- G-918 HR */

export type StaffContractType = 'permanent' | 'probation' | 'fixed_term' | 'visiting' | 'intern';
export type StaffContractStatus = 'draft' | 'active' | 'expired' | 'terminated';
export type StaffAttendanceStatus = 'present' | 'absent' | 'leave' | 'half_day';

export interface StaffContract {
  id: string;
  tenantId: string;
  staffId: string;
  contractType: string;
  startDate: string;
  endDate: string | null;
  salaryBand: string;
  status: string;
  notes: string | null;
  renewalAlert: boolean;
  daysUntilEnd: number | null;
  createdAt: string;
  updatedAt: string;
}

export interface StaffQualification {
  id: string;
  tenantId: string;
  staffId: string;
  degree: string;
  institution: string;
  year: number;
  verified: boolean;
  documentRef: string | null;
  createdAt: string;
  updatedAt: string;
}

export interface StaffAttendanceMark {
  id: string;
  tenantId: string;
  staffId: string;
  date: string;
  status: string;
  notes: string | null;
  markedBy: string | null;
  createdAt: string;
  updatedAt: string;
}

export interface StaffAttendanceSummary {
  staffId: string;
  present: number;
  absent: number;
  leave: number;
  halfDay: number;
  payableDays: number;
}

export interface StaffImportReport {
  rows: number;
  valid: number;
  created?: number;
  staffIds?: string[];
  errors: Array<{ row: number; field?: string; message: string }>;
}

export interface PayrollExport {
  month: string;
  filename: string;
  csv: string;
  rows: Array<{
    staffId: string;
    name: string;
    salaryBand: string;
    daysPresent: number;
    leaveDays: number;
    absentDays: number;
    deductionsPlaceholder: number;
    deductionsCents: number;
    grossCents: number;
    netCents: number;
    payableDays: number;
  }>;
}

export interface CreateContractInput {
  staffId: string;
  contractType: StaffContractType;
  startDate: string;
  endDate?: string;
  salaryBand?: string;
  status?: StaffContractStatus;
  notes?: string;
}

export interface CreateQualificationInput {
  staffId: string;
  degree: string;
  institution: string;
  year: number;
  verified?: boolean;
  documentRef?: string;
}

export async function listStaffContracts(staffId?: string): Promise<StaffContract[]> {
  const qs = staffId ? `?staffId=${encodeURIComponent(staffId)}` : '';
  const result = await gatewayFetch<{ data: StaffContract[] }>(`/staff/contracts${qs}`, {
    method: 'GET',
    throwOnError: false,
    next: { revalidate: 0 },
  });
  return result.ok && result.data ? (result.data.data ?? []) : [];
}

export async function createStaffContract(input: CreateContractInput): Promise<StaffContract> {
  const result = await gatewayFetch<StaffContract>('/staff/contracts', {
    method: 'POST',
    json: input,
  });
  if (!result.data) throw new Error('Empty response from staff-service');
  return result.data;
}

export async function listStaffQualifications(staffId?: string): Promise<StaffQualification[]> {
  const qs = staffId ? `?staffId=${encodeURIComponent(staffId)}` : '';
  const result = await gatewayFetch<{ data: StaffQualification[] }>(`/staff/qualifications${qs}`, {
    method: 'GET',
    throwOnError: false,
    next: { revalidate: 0 },
  });
  return result.ok && result.data ? (result.data.data ?? []) : [];
}

export async function createStaffQualification(
  input: CreateQualificationInput,
): Promise<StaffQualification> {
  const result = await gatewayFetch<StaffQualification>('/staff/qualifications', {
    method: 'POST',
    json: input,
  });
  if (!result.data) throw new Error('Empty response from staff-service');
  return result.data;
}

export async function verifyStaffQualification(
  id: string,
  verified: boolean,
  documentRef?: string,
): Promise<StaffQualification> {
  const result = await gatewayFetch<StaffQualification>(`/staff/qualifications/${id}/verify`, {
    method: 'POST',
    json: { verified, documentRef },
  });
  if (!result.data) throw new Error('Empty response from staff-service');
  return result.data;
}

export async function listStaffAttendance(
  filters: {
    date?: string;
    staffId?: string;
    from?: string;
    to?: string;
  } = {},
): Promise<StaffAttendanceMark[]> {
  const params = new URLSearchParams();
  if (filters.date) params.set('date', filters.date);
  if (filters.staffId) params.set('staffId', filters.staffId);
  if (filters.from) params.set('from', filters.from);
  if (filters.to) params.set('to', filters.to);
  const qs = params.toString();
  const result = await gatewayFetch<{ data: StaffAttendanceMark[] }>(
    `/staff/attendance${qs ? `?${qs}` : ''}`,
    { method: 'GET', throwOnError: false, next: { revalidate: 0 } },
  );
  return result.ok && result.data ? (result.data.data ?? []) : [];
}

export async function listStaffAttendanceSummary(
  month: string,
  staffId?: string,
): Promise<StaffAttendanceSummary[]> {
  const params = new URLSearchParams({ month });
  if (staffId) params.set('staffId', staffId);
  const result = await gatewayFetch<{ data: StaffAttendanceSummary[] }>(
    `/staff/attendance/summary?${params.toString()}`,
    { method: 'GET', throwOnError: false, next: { revalidate: 0 } },
  );
  return result.ok && result.data ? (result.data.data ?? []) : [];
}

export async function markStaffAttendance(input: {
  staffId: string;
  date: string;
  status: StaffAttendanceStatus;
  notes?: string;
}): Promise<StaffAttendanceMark> {
  const result = await gatewayFetch<StaffAttendanceMark>('/staff/attendance', {
    method: 'POST',
    json: input,
  });
  if (!result.data) throw new Error('Empty response from staff-service');
  return result.data;
}

export async function markStaffAttendanceBulk(input: {
  date: string;
  marks: Array<{ staffId: string; status: StaffAttendanceStatus; notes?: string }>;
}): Promise<StaffAttendanceMark[]> {
  const result = await gatewayFetch<{ data: StaffAttendanceMark[] }>('/staff/attendance/bulk', {
    method: 'POST',
    json: input,
  });
  if (!result.data) throw new Error('Empty response from staff-service');
  return result.data.data ?? [];
}

export async function dryRunStaffImport(
  csv: string,
  filename?: string,
): Promise<StaffImportReport> {
  const result = await gatewayFetch<StaffImportReport>('/staff/import/dry-run', {
    method: 'POST',
    json: { csv, filename },
  });
  if (!result.data) throw new Error('Empty response from staff-service');
  return result.data;
}

export async function commitStaffImport(
  csv: string,
  filename?: string,
): Promise<StaffImportReport> {
  const result = await gatewayFetch<StaffImportReport>('/staff/import/commit', {
    method: 'POST',
    json: { csv, filename },
  });
  if (!result.data) throw new Error('Empty response from staff-service');
  return result.data;
}

export async function exportStaffPayroll(month: string): Promise<PayrollExport> {
  const result = await gatewayFetch<PayrollExport>(
    `/staff/payroll/export?month=${encodeURIComponent(month)}`,
    { method: 'GET' },
  );
  if (!result.data) throw new Error('Empty response from staff-service');
  return result.data;
}
