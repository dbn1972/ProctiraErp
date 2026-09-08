/**
 * Assessment-service API client (server-side).
 *
 * Wraps the assessment-service endpoints exposed through the API gateway:
 *   /api/v1/grading-schemes      (CRUD)
 *   /api/v1/assessment-items     (CRUD)
 *   /api/v1/results              (single + bulk + import)
 *   /api/v1/results/grades       (calculated grades)
 *   /api/v1/outcomes             (curriculum outcomes)
 */
import { gatewayFetch } from './gateway';

/* ------------------------------------------------------------------ Types */

export type GradingSchemeType = 'numeric' | 'letter' | 'competency';

export interface GradeThreshold {
  grade: string;
  minScore: number;
  maxScore: number;
  descriptor?: string;
}

export interface GradingScheme {
  id: string;
  tenantId: string;
  name: string;
  type: GradingSchemeType;
  minValue: number;
  maxValue: number;
  thresholds: GradeThreshold[];
  createdAt: string;
  updatedAt: string;
}

export interface PaginationMeta {
  page: number;
  pageSize: number;
  totalItems: number;
  totalPages: number;
}

export interface GradingSchemeListResponse {
  data: GradingScheme[];
  meta: PaginationMeta;
}

export interface CreateGradingSchemeInput {
  name: string;
  type: GradingSchemeType;
  minValue: number;
  maxValue: number;
  thresholds: GradeThreshold[];
}

export type UpdateGradingSchemeInput = Partial<CreateGradingSchemeInput>;

export interface AssessmentItem {
  id: string;
  subjectId: string;
  academicPeriodId: string;
  gradingSchemeId: string;
  name: string;
  weight: number;
  maxScore: number;
  minScore: number;
  outcomeIds: string[];
  createdAt: string;
  updatedAt: string;
}

export interface AssessmentItemsResponse {
  subjectId: string;
  academicPeriodId: string;
  gradingSchemeId: string | null;
  totalWeight: number;
  items: AssessmentItem[];
}

export interface DefineAssessmentItemsInput {
  subjectId: string;
  academicPeriodId: string;
  gradingSchemeId: string;
  items: Array<{
    name: string;
    weight: number;
    maxScore: number;
    minScore: number;
    outcomeIds?: string[];
  }>;
}

export interface ResultEntryItem {
  studentId: string;
  assessmentItemId: string;
  score: number;
}

export interface BulkResultEntryInput {
  subjectId: string;
  academicPeriodId: string;
  results: ResultEntryItem[];
}

export interface RowValidationError {
  row: number;
  studentId: string;
  assessmentItemId: string;
  field: string;
  message: string;
}

export interface BulkResultEntryResponse {
  totalRows: number;
  successCount: number;
  errorCount: number;
  results: Array<{
    id: string;
    studentId: string;
    assessmentItemId: string;
    score: number;
    createdAt: string;
    updatedAt: string;
  }>;
  errors: RowValidationError[];
}

export interface StudentSubjectResult {
  studentId: string;
  subjectId: string;
  academicPeriodId: string;
  itemScores: Array<{
    assessmentItemId: string;
    itemName: string;
    score: number;
    maxScore: number;
    weight: number;
    weightedScore: number;
  }>;
  weightedAverage: number;
  grade: string;
  gradeDescriptor: string | null;
}

/* ----------------------------------------------------- Grading Schemes */

export interface GradingSchemeFilters {
  page?: number;
  pageSize?: number;
  search?: string;
  type?: GradingSchemeType;
}

function gradingSchemeQuery(filters: GradingSchemeFilters): string {
  const params = new URLSearchParams();
  if (filters.page) params.set('page', String(filters.page));
  if (filters.pageSize) params.set('pageSize', String(filters.pageSize));
  if (filters.search) params.set('search', filters.search);
  if (filters.type) params.set('type', filters.type);
  const qs = params.toString();
  return qs ? `?${qs}` : '';
}

export async function listGradingSchemes(
  filters: GradingSchemeFilters = {},
): Promise<GradingSchemeListResponse> {
  const result = await gatewayFetch<GradingSchemeListResponse>(
    `/grading-schemes${gradingSchemeQuery(filters)}`,
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

export async function getGradingScheme(id: string): Promise<GradingScheme | null> {
  const result = await gatewayFetch<GradingScheme>(`/grading-schemes/${id}`, {
    method: 'GET',
    throwOnError: false,
    next: { revalidate: 0 },
  });
  return result.ok ? result.data : null;
}

export async function createGradingScheme(input: CreateGradingSchemeInput): Promise<GradingScheme> {
  const result = await gatewayFetch<GradingScheme>('/grading-schemes', {
    method: 'POST',
    json: input,
  });
  if (!result.data) throw new Error('Empty response from assessment-service');
  return result.data;
}

export async function updateGradingScheme(
  id: string,
  input: UpdateGradingSchemeInput,
): Promise<GradingScheme> {
  const result = await gatewayFetch<GradingScheme>(`/grading-schemes/${id}`, {
    method: 'PUT',
    json: input,
  });
  if (!result.data) throw new Error('Empty response from assessment-service');
  return result.data;
}

export async function deleteGradingScheme(id: string): Promise<void> {
  await gatewayFetch<void>(`/grading-schemes/${id}`, { method: 'DELETE' });
}

/* ----------------------------------------------------- Assessment Items */

export async function getAssessmentItems(
  subjectId: string,
  academicPeriodId: string,
): Promise<AssessmentItemsResponse> {
  const params = new URLSearchParams({ subjectId, academicPeriodId });
  const result = await gatewayFetch<AssessmentItemsResponse>(
    `/assessment-items?${params.toString()}`,
    { method: 'GET', throwOnError: false, next: { revalidate: 0 } },
  );
  if (!result.ok || !result.data) {
    return {
      subjectId,
      academicPeriodId,
      gradingSchemeId: null,
      totalWeight: 0,
      items: [],
    };
  }
  return result.data;
}

export async function defineAssessmentItems(
  input: DefineAssessmentItemsInput,
): Promise<AssessmentItemsResponse> {
  const result = await gatewayFetch<AssessmentItemsResponse>('/assessment-items', {
    method: 'POST',
    json: input,
  });
  if (!result.data) throw new Error('Empty response from assessment-service');
  return result.data;
}

/* ---------------------------------------------------------- Results */

export async function enterBulkResults(
  input: BulkResultEntryInput,
): Promise<BulkResultEntryResponse> {
  const result = await gatewayFetch<BulkResultEntryResponse>('/results/bulk', {
    method: 'POST',
    json: input,
  });
  if (!result.data) throw new Error('Empty response from assessment-service');
  return result.data;
}

export async function importResultsFromExcel(input: {
  subjectId: string;
  academicPeriodId: string;
  rows: Array<{ studentId: string; assessmentItemId: string; score: number }>;
}): Promise<BulkResultEntryResponse> {
  const result = await gatewayFetch<BulkResultEntryResponse>('/results/import', {
    method: 'POST',
    json: input,
  });
  if (!result.data) throw new Error('Empty response from assessment-service');
  return result.data;
}

export async function getStudentResults(
  subjectId: string,
  academicPeriodId: string,
  studentId?: string,
): Promise<StudentSubjectResult[]> {
  const params = new URLSearchParams({ subjectId, academicPeriodId });
  if (studentId) params.set('studentId', studentId);
  const result = await gatewayFetch<{ data: StudentSubjectResult[] }>(
    `/results/grades?${params.toString()}`,
    { method: 'GET', throwOnError: false, next: { revalidate: 0 } },
  );
  return result.ok && result.data ? (result.data.data ?? []) : [];
}
