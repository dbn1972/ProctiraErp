/**
 * Student-service API client (server-side).
 *
 * Wraps the student-service endpoints exposed through the API gateway:
 *   /api/v1/students            (CRUD, search)
 *   /api/v1/enrollments         (history, transfer)
 *   /api/v1/students/import     (bulk import)
 *   /api/v1/custom-fields       (custom field schema for student entity)
 *
 * All calls are tenant-scoped via `gatewayFetch`.
 */
import { gatewayFetch } from './gateway';

/* ------------------------------------------------------------------ Types */

export interface Contact {
  type: string;
  value: string;
  isPrimary: boolean;
}

export interface Guardian {
  id?: string;
  firstName: string;
  lastName: string;
  relationship: string;
  contactPhone?: string;
  contactEmail?: string;
}

export interface IdentityDocument {
  type: string;
  number: string;
  issuingCountry?: string;
  expiryDate?: string;
}

export interface Student {
  id: string;
  firstName: string;
  lastName: string;
  dateOfBirth: string;
  gender: string;
  nationalId: string | null;
  nationality: string | null;
  contacts: Contact[];
  guardians: Guardian[];
  identityDocuments: IdentityDocument[];
  customData: Record<string, unknown>;
  createdAt: string;
  updatedAt: string;
}

export interface StudentListMeta {
  page: number;
  pageSize: number;
  totalItems: number;
  totalPages: number;
}

export interface StudentListResponse {
  data: Student[];
  meta: StudentListMeta;
}

export interface StudentListFilters {
  page?: number;
  pageSize?: number;
  search?: string;
  gender?: string;
  /** Convenience filter (mapped to `search` if not natively supported). */
  institutionId?: string;
  /** Convenience filter (mapped to `search`/`grade` if not natively supported). */
  gradeId?: string;
  status?: 'ENROLLED' | 'TRANSFERRED' | 'WITHDRAWN' | 'GRADUATED' | 'ALL';
  sortBy?: 'firstName' | 'lastName' | 'dateOfBirth' | 'createdAt';
  sortOrder?: 'asc' | 'desc';
}

export interface CreateStudentInput {
  firstName: string;
  lastName: string;
  dateOfBirth: string;
  gender: string;
  nationalId?: string;
  nationality?: string;
  contacts?: Contact[];
  guardians?: Guardian[];
  identityDocuments?: IdentityDocument[];
  customData?: Record<string, unknown>;
}

export type UpdateStudentInput = Partial<CreateStudentInput>;

export interface EnrollmentEntry {
  id: string;
  tenantId: string;
  studentId: string;
  institutionId: string;
  gradeId: string;
  classId: string | null;
  academicPeriodId: string;
  status: 'ENROLLED' | 'TRANSFERRED' | 'WITHDRAWN' | 'GRADUATED';
  enrolledAt: string;
  exitedAt: string | null;
  createdAt: string;
  updatedAt: string;
}

export interface EnrollmentHistoryEntry {
  id: string;
  enrollmentId: string;
  previousStatus: string | null;
  newStatus: string;
  effectiveDate: string;
  institutionId: string;
  academicPeriodId: string;
  reason: string | null;
  createdAt: string;
}

export interface TransferRecord {
  id: string;
  studentId: string;
  sourceInstitutionId: string;
  sourceEnrollmentId: string;
  destinationInstitutionId: string;
  destinationEnrollmentId: string;
  transferDate: string;
  reason: string;
  createdAt: string;
}

export interface StudentTransferInput {
  studentId: string;
  sourceEnrollmentId: string;
  destinationInstitutionId: string;
  destinationGradeId: string;
  destinationClassId?: string;
  academicPeriodId: string;
  transferDate: string;
  reason: string;
}

export interface CustomFieldDefinition {
  id: string;
  entityType: 'student' | 'staff' | 'institution';
  fieldKey: string;
  label: string;
  description: string | null;
  fieldType: 'text' | 'number' | 'date' | 'dropdown' | 'checkbox' | 'textarea' | 'file';
  validationRules: {
    required?: boolean;
    minLength?: number;
    maxLength?: number;
    min?: number;
    max?: number;
    pattern?: string;
    options?: string[];
  } | null;
  displayOrder: number;
  isActive: boolean;
}

export interface ImportRowError {
  rowNumber: number;
  field: string;
  message: string;
  code: string;
}

export interface ImportDuplicate {
  rowNumber: number;
  existingStudentId: string;
  matchType: 'national_id' | 'name_dob';
  matchedFields: Record<string, string>;
}

export interface ImportResult {
  totalRows: number;
  successCount: number;
  errorCount: number;
  duplicateCount: number;
  errors: ImportRowError[];
  duplicates: ImportDuplicate[];
}

export interface ImportProgress {
  jobId: string;
  status: 'queued' | 'processing' | 'completed' | 'failed';
  totalRows: number;
  processedRows: number;
  progressPercent: number;
  result?: ImportResult;
  errorMessage?: string;
  startedAt: string;
  completedAt?: string;
}

/* --------------------------------------------------------------- Students */

function toQuery(filters: StudentListFilters): string {
  const params = new URLSearchParams();
  if (filters.page) params.set('page', String(filters.page));
  if (filters.pageSize) params.set('pageSize', String(filters.pageSize));
  if (filters.search) params.set('search', filters.search);
  if (filters.gender) params.set('gender', filters.gender);
  if (filters.sortBy) params.set('sortBy', filters.sortBy);
  if (filters.sortOrder) params.set('sortOrder', filters.sortOrder);
  // institutionId, gradeId, status are forwarded so the backend can ignore
  // them gracefully if it doesn't support them yet.
  if (filters.institutionId) params.set('institutionId', filters.institutionId);
  if (filters.gradeId) params.set('gradeId', filters.gradeId);
  if (filters.status && filters.status !== 'ALL') params.set('status', filters.status);
  const qs = params.toString();
  return qs ? `?${qs}` : '';
}

export async function listStudents(
  filters: StudentListFilters = {},
): Promise<StudentListResponse> {
  const result = await gatewayFetch<StudentListResponse>(
    `/students${toQuery(filters)}`,
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

export async function getStudent(id: string): Promise<Student | null> {
  const result = await gatewayFetch<Student>(`/students/${id}`, {
    method: 'GET',
    throwOnError: false,
    next: { revalidate: 0 },
  });
  return result.ok ? result.data : null;
}

export async function createStudent(input: CreateStudentInput): Promise<Student> {
  const result = await gatewayFetch<Student>('/students', {
    method: 'POST',
    json: input,
  });
  if (!result.data) {
    throw new Error('Empty response from student-service');
  }
  return result.data;
}

export async function updateStudent(
  id: string,
  input: UpdateStudentInput,
): Promise<Student> {
  const result = await gatewayFetch<Student>(`/students/${id}`, {
    method: 'PUT',
    json: input,
  });
  if (!result.data) {
    throw new Error('Empty response from student-service');
  }
  return result.data;
}

export async function deleteStudent(id: string): Promise<void> {
  await gatewayFetch<void>(`/students/${id}`, { method: 'DELETE' });
}

/* --------------------------------------------------------- Enrollments */

export async function getStudentEnrollments(
  studentId: string,
): Promise<EnrollmentEntry[]> {
  const result = await gatewayFetch<{ data: EnrollmentEntry[]; meta: StudentListMeta }>(
    `/enrollments?studentId=${encodeURIComponent(studentId)}&pageSize=100`,
    { method: 'GET', throwOnError: false, next: { revalidate: 0 } },
  );
  return result.ok && result.data ? result.data.data : [];
}

export async function getEnrollmentHistory(
  studentId: string,
): Promise<EnrollmentHistoryEntry[]> {
  const result = await gatewayFetch<{ data: EnrollmentHistoryEntry[] }>(
    `/enrollments/student/${encodeURIComponent(studentId)}/history`,
    { method: 'GET', throwOnError: false, next: { revalidate: 0 } },
  );
  return result.ok && result.data ? result.data.data : [];
}

export async function getTransferRecords(
  studentId: string,
): Promise<TransferRecord[]> {
  const result = await gatewayFetch<{ data: TransferRecord[] }>(
    `/enrollments/student/${encodeURIComponent(studentId)}/transfers`,
    { method: 'GET', throwOnError: false, next: { revalidate: 0 } },
  );
  return result.ok && result.data ? result.data.data : [];
}

export async function transferStudent(input: StudentTransferInput): Promise<{
  sourceEnrollment: EnrollmentEntry;
  destinationEnrollment: EnrollmentEntry;
  transferRecord: TransferRecord;
}> {
  const result = await gatewayFetch<{
    sourceEnrollment: EnrollmentEntry;
    destinationEnrollment: EnrollmentEntry;
    transferRecord: TransferRecord;
  }>('/enrollments/transfer', { method: 'POST', json: input });
  if (!result.data) {
    throw new Error('Empty response from enrollment-service');
  }
  return result.data;
}

/* ---------------------------------------------------------- Custom Fields */

export async function getStudentCustomFields(): Promise<CustomFieldDefinition[]> {
  const result = await gatewayFetch<{
    data: CustomFieldDefinition[];
    meta?: StudentListMeta;
  }>('/custom-fields?entityType=student&isActive=true&pageSize=100', {
    method: 'GET',
    throwOnError: false,
    next: { revalidate: 60 },
  });
  return result.ok && result.data ? result.data.data ?? [] : [];
}

/* ----------------------------------------------------------- Bulk Import */

export interface BulkImportRequest {
  fileBase64: string;
  fileName: string;
  mimeType: string;
  duplicateResolution: 'skip' | 'update' | 'create';
  async?: boolean;
}

export async function submitBulkImport(
  request: BulkImportRequest,
): Promise<ImportResult | ImportProgress> {
  const result = await gatewayFetch<ImportResult | ImportProgress>(
    '/students/import',
    {
      method: 'POST',
      json: {
        file: {
          buffer: request.fileBase64,
          filename: request.fileName,
          mimetype: request.mimeType,
        },
        duplicateResolution: request.duplicateResolution,
        async: request.async ?? false,
      },
    },
  );
  if (!result.data) {
    throw new Error('Empty response from import endpoint');
  }
  return result.data;
}

export async function getImportProgress(jobId: string): Promise<ImportProgress | null> {
  const result = await gatewayFetch<ImportProgress>(
    `/students/import/${encodeURIComponent(jobId)}`,
    { method: 'GET', throwOnError: false, next: { revalidate: 0 } },
  );
  return result.ok ? result.data : null;
}
