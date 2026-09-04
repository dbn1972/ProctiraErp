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

export async function listStaff(
  filters: StaffListFilters = {},
): Promise<StaffListResponse> {
  const result = await gatewayFetch<StaffListResponse>(
    `/staff${buildQuery(filters)}`,
    { method: 'GET', throwOnError: false, next: { revalidate: 0 } },
  );
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

export async function updateStaff(
  id: string,
  input: UpdateStaffInput,
): Promise<Staff> {
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

export interface AssignmentListFilters {
  page?: number;
  pageSize?: number;
  staffId?: string;
  institutionId?: string;
  subjectId?: string;
  classId?: string;
  status?: 'ACTIVE' | 'INACTIVE';
}

function buildAssignmentQuery(filters: AssignmentListFilters): string {
  const params = new URLSearchParams();
  if (filters.page) params.set('page', String(filters.page));
  if (filters.pageSize) params.set('pageSize', String(filters.pageSize));
  if (filters.staffId) params.set('staffId', filters.staffId);
  if (filters.institutionId) params.set('institutionId', filters.institutionId);
  if (filters.subjectId) params.set('subjectId', filters.subjectId);
  if (filters.classId) params.set('classId', filters.classId);
  if (filters.status) params.set('status', filters.status);
  const qs = params.toString();
  return qs ? `?${qs}` : '';
}

export async function listAssignments(
  filters: AssignmentListFilters = {},
): Promise<Assignment[]> {
  const result = await gatewayFetch<{ data: Assignment[]; meta?: PaginationMeta }>(
    `/staff/assignments${buildAssignmentQuery({ pageSize: 100, ...filters })}`,
    { method: 'GET', throwOnError: false, next: { revalidate: 0 } },
  );
  return result.ok && result.data ? result.data.data ?? [] : [];
}

export async function listStaffAssignments(
  staffId: string,
): Promise<Assignment[]> {
  return listAssignments({ staffId, pageSize: 100 });
}

export async function createAssignment(
  input: CreateAssignmentInput,
): Promise<Assignment> {
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
  return result.ok && result.data ? result.data.data ?? [] : [];
}

export async function getAppraisalTemplate(
  templateId: string,
): Promise<AppraisalTemplate | null> {
  const result = await gatewayFetch<AppraisalTemplate>(
    `/staff/appraisals/templates/${templateId}`,
    { method: 'GET', throwOnError: false, next: { revalidate: 30 } },
  );
  return result.ok ? result.data : null;
}

export async function listStaffAppraisals(
  staffId: string,
): Promise<Appraisal[]> {
  const result = await gatewayFetch<{ data: Appraisal[] }>(
    `/staff/appraisals?staffId=${encodeURIComponent(staffId)}&pageSize=100`,
    { method: 'GET', throwOnError: false, next: { revalidate: 0 } },
  );
  return result.ok && result.data ? result.data.data ?? [] : [];
}

export async function createAppraisal(
  input: CreateAppraisalInput,
): Promise<Appraisal> {
  const result = await gatewayFetch<Appraisal>('/staff/appraisals', {
    method: 'POST',
    json: input,
  });
  if (!result.data) throw new Error('Empty response from staff-service');
  return result.data;
}

/* ------------------------------------------------------------- Training */

export async function listStaffCertifications(
  staffId: string,
): Promise<TrainingCertification[]> {
  const result = await gatewayFetch<{ data: TrainingCertification[] }>(
    `/staff/training/certifications?staffId=${encodeURIComponent(staffId)}&pageSize=100`,
    { method: 'GET', throwOnError: false, next: { revalidate: 0 } },
  );
  return result.ok && result.data ? result.data.data ?? [] : [];
}
