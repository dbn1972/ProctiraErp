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
import {
  GATEWAY_API_PREFIX,
  GATEWAY_BASE_URL,
  GatewayError,
  gatewayFetch,
  getSessionContext,
  tenantHeader,
} from './gateway';
import { MAX_API_PAGE_SIZE, clampPageSize } from './pagination';
import { MAX_AUTO_PAGES, gatewayFetchAllPages } from './gateway-all-pages';

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
  destinationClassId: string;
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
  // Clamped: the gateway's pagination preHandler rejects pageSize > 100 and this
  // client turns a non-ok response into an empty list, so an over-sized value
  // would render as 'no results' rather than as an error.
  if (filters.pageSize) params.set('pageSize', String(clampPageSize(filters.pageSize)));
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

export async function listStudents(filters: StudentListFilters = {}): Promise<StudentListResponse> {
  const result = await gatewayFetch<StudentListResponse>(`/students${toQuery(filters)}`, {
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

/**
 * Resolves to `null` when the student is missing (404) or the gateway is
 * unreachable (network / status 0). Ungated shells and unknown-id routes must
 * render the not-found page rather than an error boundary when the API is
 * offline. Auth and 5xx responses still throw.
 */
export async function getStudent(id: string): Promise<Student | null> {
  const result = await gatewayFetch<Student>(`/students/${encodeURIComponent(id)}`, {
    method: 'GET',
    throwOnError: false,
    next: { revalidate: 0 },
  });
  if (result.ok) return result.data;
  if (result.status === 404 || result.status === 0) return null;
  throw new GatewayError({
    status: result.status,
    code: result.error?.code ?? 'GATEWAY_ERROR',
    message: result.error?.message ?? `Failed to load student (${result.status})`,
    details: result.error?.details,
  });
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

export async function updateStudent(id: string, input: UpdateStudentInput): Promise<Student> {
  const result = await gatewayFetch<Student>(`/students/${encodeURIComponent(id)}`, {
    method: 'PUT',
    json: input,
  });
  if (!result.data) {
    throw new Error('Empty response from student-service');
  }
  return result.data;
}

export async function deleteStudent(id: string): Promise<void> {
  await gatewayFetch<void>(`/students/${encodeURIComponent(id)}`, { method: 'DELETE' });
}

/* --------------------------------------------------------- Enrollments */

export interface CreateEnrollmentInput {
  studentId: string;
  institutionId: string;
  gradeId: string;
  classId: string;
  academicPeriodId: string;
  enrolledAt: string;
}

export async function createEnrollment(input: CreateEnrollmentInput): Promise<EnrollmentEntry> {
  const result = await gatewayFetch<EnrollmentEntry>('/enrollments', {
    method: 'POST',
    json: input,
  });
  if (!result.data) {
    throw new Error('Empty response from enrollment-service');
  }
  return result.data;
}

export type EnrollmentLookupResult =
  { ok: true; enrollments: EnrollmentEntry[] } | { ok: false; status: number };

/**
 * Enrollment lookup that distinguishes "no enrollments" from "lookup failed"
 * so callers can report failures instead of silently dropping a student
 * (PRC-L247).
 */
export async function getStudentEnrollmentsResult(
  studentId: string,
): Promise<EnrollmentLookupResult> {
  // PRC-L074: follow meta.totalPages instead of truncating at one page; any
  // failed page is a failed lookup (a partial list would drop enrollments).
  const enrollments: EnrollmentEntry[] = [];
  try {
    for (let page = 1; page <= MAX_AUTO_PAGES; page += 1) {
      const result = await gatewayFetch<{ data: EnrollmentEntry[]; meta?: StudentListMeta }>(
        `/enrollments?studentId=${encodeURIComponent(studentId)}&page=${page}&pageSize=${MAX_API_PAGE_SIZE}`,
        { method: 'GET', throwOnError: false, next: { revalidate: 0 } },
      );
      if (!result.ok || !result.data) return { ok: false, status: result.status };
      // A failed page already returned above; this only appends real rows.
      if (Array.isArray(result.data.data)) enrollments.push(...result.data.data);
      const totalPages = result.data.meta?.totalPages;
      if (!totalPages || page >= totalPages) break;
    }
    return { ok: true, enrollments };
  } catch {
    return { ok: false, status: 0 };
  }
}

export async function getStudentEnrollments(studentId: string): Promise<EnrollmentEntry[]> {
  return gatewayFetchAllPages<EnrollmentEntry>(
    `/enrollments?studentId=${encodeURIComponent(studentId)}`,
    { next: { revalidate: 0 } },
  );
}

export async function getEnrollmentHistory(studentId: string): Promise<EnrollmentHistoryEntry[]> {
  const result = await gatewayFetch<{ data: EnrollmentHistoryEntry[] }>(
    `/enrollments/student/${encodeURIComponent(studentId)}/history`,
    { method: 'GET', throwOnError: false, next: { revalidate: 0 } },
  );
  return result.ok && result.data ? result.data.data : [];
}

export async function getTransferRecords(studentId: string): Promise<TransferRecord[]> {
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

export interface UpdateEnrollmentStatusInput {
  status: 'WITHDRAWN' | 'GRADUATED';
  reason: string;
  effectiveDate: string;
}

export async function updateEnrollmentStatus(
  enrollmentId: string,
  input: UpdateEnrollmentStatusInput,
): Promise<EnrollmentEntry> {
  const result = await gatewayFetch<EnrollmentEntry>(
    `/enrollments/${encodeURIComponent(enrollmentId)}/status`,
    { method: 'POST', json: input },
  );
  if (!result.data) {
    throw new Error('Empty response from enrollment-service');
  }
  return result.data;
}

export interface BulkUpdateEnrollmentStatusInput extends UpdateEnrollmentStatusInput {
  enrollmentIds: string[];
}

export interface BulkUpdateEnrollmentStatusResult {
  updated: EnrollmentEntry[];
  failed: Array<{ enrollmentId: string; code: string; message: string }>;
}

/** Wave 11 — withdraw or graduate many enrollments in one call. */
export async function bulkUpdateEnrollmentStatus(
  input: BulkUpdateEnrollmentStatusInput,
): Promise<BulkUpdateEnrollmentStatusResult> {
  const result = await gatewayFetch<BulkUpdateEnrollmentStatusResult>('/enrollments/bulk-status', {
    method: 'POST',
    json: input,
  });
  if (!result.data) {
    throw new Error('Empty response from enrollment-service');
  }
  return result.data;
}

/* ---------------------------------------------------------- Custom Fields */

export async function getStudentCustomFields(): Promise<CustomFieldDefinition[]> {
  return gatewayFetchAllPages<CustomFieldDefinition>(
    '/custom-fields?entityType=student&isActive=true',
    { next: { revalidate: 60 } },
  );
}

/* ----------------------------------------------------------- Bulk Import */

export interface BulkImportRequest {
  fileBase64: string;
  fileName: string;
  mimeType: string;
  duplicateResolution: 'skip' | 'update' | 'create';
  async?: boolean;
}

/** Mirrors the student import route limit (MAX_IMPORT_FILE_SIZE, 50 MB). */
export const MAX_STUDENT_IMPORT_BYTES = 50 * 1024 * 1024;

/** Decoded byte size of a base64 payload (ignores padding). */
export function base64DecodedSize(base64: string): number {
  const trimmed = base64.replace(/\s/g, '');
  const padding = trimmed.endsWith('==') ? 2 : trimmed.endsWith('=') ? 1 : 0;
  return Math.max(0, Math.floor((trimmed.length * 3) / 4) - padding);
}

/** Returns a user-facing error when the import file exceeds the gateway limit. */
export function validateBulkImportSize(fileBase64: string): string | null {
  return base64DecodedSize(fileBase64) > MAX_STUDENT_IMPORT_BYTES
    ? 'The import file is larger than 50 MB. Split it into smaller files and try again.'
    : null;
}

export async function submitBulkImport(
  request: BulkImportRequest,
): Promise<ImportResult | ImportProgress> {
  const sizeError = validateBulkImportSize(request.fileBase64);
  if (sizeError) throw new Error(sizeError);
  const result = await gatewayFetch<ImportResult | ImportProgress>('/students/import', {
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
  });
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

/* ----------------------------------------------------------- Students 360 (G-914) */

export type ConsentKind = 'photo' | 'medical' | 'trips' | 'data_sharing';
export type DisciplineSeverity = 'low' | 'medium' | 'high' | 'critical';
export type HeatSlot = 'present' | 'half' | 'absent' | 'empty';

export interface StudentPhotoMeta {
  id: string;
  studentId: string;
  mimeType: string;
  sizeBytes: number;
  uploadedBy: string;
  createdAt: string;
}

export interface StudentSibling {
  id: string;
  studentId: string;
  siblingId: string;
  createdAt: string;
}

export interface StudentConsent {
  id: string;
  studentId: string;
  kind: ConsentKind;
  granted: boolean;
  actorId: string;
  recordedAt: string;
}

export interface DisciplineIncident {
  id: string;
  studentId: string;
  incidentType: string;
  severity: DisciplineSeverity;
  description: string;
  actionTaken: string | null;
  reporterId: string;
  incidentDate: string;
  visibleToParent: boolean;
  createdAt: string;
}

export interface AttendanceHeatmapDay {
  date: string;
  status: string | null;
  slot: HeatSlot;
}

export interface AttendanceHeatmap {
  from: string;
  to: string;
  attendancePercentage: number;
  absencePercentage: number;
  totalRecords: number;
  presentCount: number;
  absentCount: number;
  lateCount: number;
  excusedCount: number;
  days: AttendanceHeatmapDay[];
}

export async function uploadStudentPhoto(
  studentId: string,
  input: { contentBase64: string; mimeType: string },
): Promise<StudentPhotoMeta> {
  const result = await gatewayFetch<StudentPhotoMeta>(
    `/students/${encodeURIComponent(studentId)}/photo`,
    {
      method: 'POST',
      json: input,
    },
  );
  if (!result.data) throw new Error('Empty response from photo upload');
  return result.data;
}

/** Timeout for the photo existence probe; the profile page must not hang on it. */
export const STUDENT_PHOTO_PROBE_TIMEOUT_MS = 5_000;

/**
 * Checks whether a student has a stored photo without downloading it.
 * Uses HEAD (Fastify exposes HEAD for every GET route), a bounded timeout,
 * and cancels any body a proxy might still attach.
 */
export async function studentHasPhoto(studentId: string): Promise<boolean> {
  const { tenantId, accessToken } = await getSessionContext();
  try {
    const response = await fetch(
      `${GATEWAY_BASE_URL}${GATEWAY_API_PREFIX}/students/${encodeURIComponent(studentId)}/photo`,
      {
        method: 'HEAD',
        headers: {
          ...tenantHeader(tenantId),
          ...(accessToken ? { Authorization: `Bearer ${accessToken}` } : {}),
        },
        cache: 'no-store',
        signal: AbortSignal.timeout(STUDENT_PHOTO_PROBE_TIMEOUT_MS),
      },
    );
    await response.body?.cancel().catch(() => undefined);
    return response.ok;
  } catch {
    return false;
  }
}

export async function listStudentSiblings(studentId: string): Promise<StudentSibling[]> {
  const result = await gatewayFetch<{ data: StudentSibling[] }>(
    `/students/${encodeURIComponent(studentId)}/siblings`,
    {
      method: 'GET',
      throwOnError: false,
      next: { revalidate: 0 },
    },
  );
  return result.ok && result.data ? result.data.data : [];
}

export async function addStudentSibling(
  studentId: string,
  siblingId: string,
): Promise<StudentSibling> {
  const result = await gatewayFetch<StudentSibling>(
    `/students/${encodeURIComponent(studentId)}/siblings`,
    {
      method: 'POST',
      json: { siblingId },
    },
  );
  if (!result.data) throw new Error('Empty response from sibling link');
  return result.data;
}

export async function removeStudentSibling(studentId: string, siblingId: string): Promise<void> {
  await gatewayFetch<void>(
    `/students/${encodeURIComponent(studentId)}/siblings/${encodeURIComponent(siblingId)}`,
    { method: 'DELETE' },
  );
}

export async function listStudentConsents(studentId: string): Promise<StudentConsent[]> {
  const result = await gatewayFetch<{ data: StudentConsent[] }>(
    `/students/${encodeURIComponent(studentId)}/consents`,
    {
      method: 'GET',
      throwOnError: false,
      next: { revalidate: 0 },
    },
  );
  return result.ok && result.data ? result.data.data : [];
}

export async function setStudentConsent(
  studentId: string,
  input: { kind: ConsentKind; granted: boolean },
): Promise<StudentConsent> {
  const result = await gatewayFetch<StudentConsent>(
    `/students/${encodeURIComponent(studentId)}/consents`,
    {
      method: 'PUT',
      json: input,
    },
  );
  if (!result.data) throw new Error('Empty response from consent update');
  return result.data;
}

export async function listStudentDiscipline(studentId: string): Promise<DisciplineIncident[]> {
  const result = await gatewayFetch<{ data: DisciplineIncident[] }>(
    `/students/${encodeURIComponent(studentId)}/discipline`,
    { method: 'GET', throwOnError: false, next: { revalidate: 0 } },
  );
  return result.ok && result.data ? result.data.data : [];
}

export async function addStudentDiscipline(
  studentId: string,
  input: {
    incidentType: string;
    severity: DisciplineSeverity;
    description: string;
    actionTaken?: string;
    incidentDate: string;
    visibleToParent?: boolean;
  },
): Promise<DisciplineIncident> {
  const result = await gatewayFetch<DisciplineIncident>(
    `/students/${encodeURIComponent(studentId)}/discipline`,
    {
      method: 'POST',
      json: input,
    },
  );
  if (!result.data) throw new Error('Empty response from discipline create');
  return result.data;
}

export async function removeStudentDiscipline(
  studentId: string,
  incidentId: string,
): Promise<void> {
  await gatewayFetch<void>(
    `/students/${encodeURIComponent(studentId)}/discipline/${encodeURIComponent(incidentId)}`,
    {
      method: 'DELETE',
    },
  );
}

export async function getStudentAttendanceHeatmap(
  studentId: string,
  range?: { from?: string; to?: string },
): Promise<AttendanceHeatmap | null> {
  const params = new URLSearchParams();
  if (range?.from) params.set('from', range.from);
  if (range?.to) params.set('to', range.to);
  const qs = params.toString();
  const result = await gatewayFetch<AttendanceHeatmap>(
    `/students/${encodeURIComponent(studentId)}/attendance-heatmap${qs ? `?${qs}` : ''}`,
    { method: 'GET', throwOnError: false, next: { revalidate: 0 } },
  );
  return result.ok ? result.data : null;
}
