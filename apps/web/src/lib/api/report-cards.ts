/**
 * Report-card API client (server-side).
 *
 * Wraps assessment-service report-card endpoints via the API gateway:
 *   GET/POST/PUT/DELETE /api/v1/report-cards/templates
 *   GET/POST            /api/v1/report-cards/comments
 *   POST                /api/v1/report-cards/generate
 *   POST                /api/v1/report-cards/generate/bulk
 *   GET                 /api/v1/report-cards/jobs/:jobId
 */
import { gatewayFetch } from './gateway';

/* ------------------------------------------------------------------ Types */

export type ReportCardJobStatus =
  | 'queued'
  | 'processing'
  | 'completed'
  | 'failed';

export interface ReportCardTemplate {
  id: string;
  tenantId: string;
  name: string;
  templateContent: string;
  isDefault: boolean;
  includeLogo: boolean;
  includeGradeSummary: boolean;
  includeComments: boolean;
  createdAt: string;
  updatedAt: string;
}

export interface CreateReportCardTemplateInput {
  name: string;
  templateContent: string;
  isDefault?: boolean;
  includeLogo?: boolean;
  includeGradeSummary?: boolean;
  includeComments?: boolean;
}

export type UpdateReportCardTemplateInput =
  Partial<CreateReportCardTemplateInput>;

export interface TeacherComment {
  id: string;
  studentId: string;
  subjectId: string;
  academicPeriodId: string;
  teacherId: string;
  comment: string;
  createdAt: string;
  updatedAt: string;
}

export interface UpsertTeacherCommentInput {
  studentId: string;
  subjectId: string;
  academicPeriodId: string;
  teacherId: string;
  comment: string;
}

export interface GenerateReportCardInput {
  studentId: string;
  academicPeriodId: string;
  templateId?: string;
  institutionId: string;
}

export interface BulkGenerateReportCardInput {
  studentIds: string[];
  academicPeriodId: string;
  templateId?: string;
  institutionId: string;
}

export interface ReportCardJob {
  id: string;
  studentId: string;
  academicPeriodId: string;
  templateId: string;
  institutionId: string;
  status: ReportCardJobStatus;
  errorMessage: string | null;
  outputUrl: string | null;
  createdAt: string;
  updatedAt: string;
  completedAt: string | null;
}

export interface BulkGenerateReportCardResponse {
  totalStudents: number;
  jobsCreated: number;
  jobs: ReportCardJob[];
}

/* ----------------------------------------------------------- Templates */

export async function listReportCardTemplates(): Promise<ReportCardTemplate[]> {
  const result = await gatewayFetch<{ data: ReportCardTemplate[] }>(
    '/report-cards/templates',
    { method: 'GET', throwOnError: false, next: { revalidate: 0 } },
  );
  if (!result.ok || !result.data) return [];
  return Array.isArray(result.data.data) ? result.data.data : [];
}

export async function getReportCardTemplate(
  id: string,
): Promise<ReportCardTemplate | null> {
  const result = await gatewayFetch<ReportCardTemplate>(
    `/report-cards/templates/${encodeURIComponent(id)}`,
    { method: 'GET', throwOnError: false, next: { revalidate: 0 } },
  );
  return result.ok ? result.data : null;
}

export async function createReportCardTemplate(
  input: CreateReportCardTemplateInput,
): Promise<ReportCardTemplate> {
  const result = await gatewayFetch<ReportCardTemplate>(
    '/report-cards/templates',
    { method: 'POST', json: input },
  );
  if (!result.data) throw new Error('Empty response from report-cards API');
  return result.data;
}

export async function updateReportCardTemplate(
  id: string,
  input: UpdateReportCardTemplateInput,
): Promise<ReportCardTemplate> {
  const result = await gatewayFetch<ReportCardTemplate>(
    `/report-cards/templates/${encodeURIComponent(id)}`,
    { method: 'PUT', json: input },
  );
  if (!result.data) throw new Error('Empty response from report-cards API');
  return result.data;
}

export async function deleteReportCardTemplate(id: string): Promise<void> {
  await gatewayFetch<void>(`/report-cards/templates/${encodeURIComponent(id)}`, {
    method: 'DELETE',
  });
}

/* ------------------------------------------------------------- Comments */

export async function listTeacherComments(
  studentId: string,
  academicPeriodId: string,
): Promise<TeacherComment[]> {
  const params = new URLSearchParams({ studentId, academicPeriodId });
  const result = await gatewayFetch<{ data: TeacherComment[] }>(
    `/report-cards/comments?${params.toString()}`,
    { method: 'GET', throwOnError: false, next: { revalidate: 0 } },
  );
  if (!result.ok || !result.data) return [];
  return Array.isArray(result.data.data) ? result.data.data : [];
}

export async function upsertTeacherComment(
  input: UpsertTeacherCommentInput,
): Promise<TeacherComment> {
  const result = await gatewayFetch<TeacherComment>('/report-cards/comments', {
    method: 'POST',
    json: input,
  });
  if (!result.data) throw new Error('Empty response from report-cards API');
  return result.data;
}

/* ----------------------------------------------------------- Generation */

export async function generateReportCard(
  input: GenerateReportCardInput,
): Promise<ReportCardJob> {
  const result = await gatewayFetch<ReportCardJob>('/report-cards/generate', {
    method: 'POST',
    json: input,
  });
  if (!result.data) throw new Error('Empty response from report-cards API');
  return result.data;
}

export async function bulkGenerateReportCards(
  input: BulkGenerateReportCardInput,
): Promise<BulkGenerateReportCardResponse> {
  const result = await gatewayFetch<BulkGenerateReportCardResponse>(
    '/report-cards/generate/bulk',
    { method: 'POST', json: input },
  );
  if (!result.data) throw new Error('Empty response from report-cards API');
  return result.data;
}

export async function getReportCardJob(
  jobId: string,
): Promise<ReportCardJob | null> {
  const result = await gatewayFetch<ReportCardJob>(
    `/report-cards/jobs/${encodeURIComponent(jobId)}`,
    { method: 'GET', throwOnError: false, next: { revalidate: 0 } },
  );
  return result.ok ? result.data : null;
}
