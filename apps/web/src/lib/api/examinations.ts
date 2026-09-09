/**
 * Examination service client.
 *
 * Thin wrapper around the gateway API for the examination module
 * (Requirement 10.1: examination definitions, candidate registration,
 * results, and document generation).
 *
 * Each call surfaces the response from the upstream service through the
 * `gatewayFetch` helper which auto-forwards Authorization + X-Tenant-ID.
 */
import { gatewayFetch } from './gateway';
import type { CreateExaminationFormValues } from '@/lib/validation/examination-schema';

export interface Examination {
  id: string;
  name: string;
  code: string;
  /** Normalized from API `startDate` for list/detail UI. */
  examinationDate: string;
  startDate?: string;
  endDate?: string;
  registrationStartDate?: string | null;
  registrationEndDate?: string | null;
  status: 'DRAFT' | 'SCHEDULED' | 'IN_PROGRESS' | 'OPEN' | 'CLOSED' | 'COMPLETED' | 'CANCELLED';
  candidateCount?: number;
  resultsPublished?: boolean;
  subjects: ExaminationSubject[];
  centers: ExaminationCenter[];
}

export interface ExaminationSubject {
  id: string;
  name: string;
  code: string;
  maxScore: number;
}

export interface ExaminationCenter {
  id: string;
  name: string;
  code: string;
  institutionId: string;
  capacity: number;
}

/** Candidate registration row (GET /examinations/:id/candidates). */
export interface ExaminationCandidate {
  id: string;
  examinationId: string;
  studentId: string;
  centerId: string;
  subjectIds: string[];
  status: 'REGISTERED' | 'CONFIRMED' | 'WITHDRAWN';
  registeredAt: string;
}

/** Row on the Results tab, merged from recorded marks and the publication. */
export interface ExaminationResult {
  candidateId: string;
  studentId: string;
  centerId: string;
  subjects: Array<{ id: string; code: string; score: number | null; grade: string | null }>;
  totalScore: number | null;
  maxScore: number;
  status: 'PENDING' | 'INCOMPLETE' | 'PUBLISHED';
}

export interface ExaminationResultsView {
  published: boolean;
  publishedAt: string | null;
  rows: ExaminationResult[];
  subjects: ExaminationSubject[];
}

export type ExaminationDocumentType = 'admit_card' | 'seating_plan' | 'result_certificate';

/** Document generation job (GET /examinations/:id/documents/jobs). */
export interface ExaminationDocument {
  id: string;
  documentType: ExaminationDocumentType;
  status: 'queued' | 'processing' | 'completed' | 'failed';
  totalCandidates: number;
  processedCount: number;
  failedCount: number;
  errorMessage?: string;
  createdAt: string;
  completedAt?: string;
  /** Same-origin download URL, present once the job is completed. */
  downloadPath: string | null;
}

/** Payload aligned with backend `CreateExaminationSchema`. */
export type CreateExaminationInput = {
  name: string;
  code: string;
  description?: string;
  academicPeriodId: string;
  startDate: string;
  endDate: string;
  subjects: Array<{ name: string; code: string; maxScore: number }>;
  centers: Array<{
    name: string;
    code: string;
    institutionId: string;
    capacity: number;
  }>;
  gradingSchemes: Array<{
    name: string;
    minScore: number;
    maxScore: number;
    passThreshold: number;
    thresholds: Array<{
      grade: string;
      minScore: number;
      maxScore: number;
      descriptor?: string;
    }>;
  }>;
};

/** Raw gateway examination entity (startDate/endDate from formatExaminationResponse). */
interface ExaminationApiRecord {
  id: string;
  name: string;
  code: string;
  startDate?: string;
  endDate?: string;
  examinationDate?: string;
  registrationStartDate?: string | null;
  registrationEndDate?: string | null;
  status: Examination['status'];
  candidateCount?: number;
  resultsPublished?: boolean;
  subjects?: ExaminationSubject[];
  centers?: ExaminationCenter[];
}

function normalizeExamination(raw: ExaminationApiRecord): Examination {
  const start = raw.startDate ?? raw.examinationDate ?? '';
  return {
    id: raw.id,
    name: raw.name,
    code: raw.code,
    examinationDate: start,
    startDate: raw.startDate,
    endDate: raw.endDate,
    registrationStartDate: raw.registrationStartDate,
    registrationEndDate: raw.registrationEndDate,
    status: raw.status,
    candidateCount: raw.candidateCount,
    resultsPublished: raw.resultsPublished,
    subjects: raw.subjects ?? [],
    centers: raw.centers ?? [],
  };
}

export function toCreateExaminationInput(
  values: CreateExaminationFormValues,
): CreateExaminationInput {
  const input: CreateExaminationInput = {
    name: values.name.trim(),
    code: values.code.trim(),
    academicPeriodId: values.academicPeriodId,
    startDate: values.startDate,
    endDate: values.endDate,
    subjects: values.subjects.map((s) => ({
      name: s.name.trim(),
      code: s.code.trim(),
      maxScore: s.maxScore,
    })),
    centers: values.centers.map((c) => ({
      name: c.name.trim(),
      code: c.code.trim(),
      institutionId: c.institutionId,
      capacity: c.capacity,
    })),
    gradingSchemes: values.gradingSchemes.map((g) => ({
      name: g.name.trim(),
      minScore: g.minScore,
      maxScore: g.maxScore,
      passThreshold: g.passThreshold,
      thresholds: g.thresholds.map((t) => {
        const row: CreateExaminationInput['gradingSchemes'][number]['thresholds'][number] = {
          grade: t.grade.trim(),
          minScore: t.minScore,
          maxScore: t.maxScore,
        };
        if (t.descriptor && t.descriptor.trim()) {
          row.descriptor = t.descriptor.trim();
        }
        return row;
      }),
    })),
  };
  if (values.description?.trim()) {
    input.description = values.description.trim();
  }
  return input;
}

/** List examinations with optional status filtering. */
export async function listExaminations(): Promise<Examination[]> {
  const result = await gatewayFetch<{ data: ExaminationApiRecord[] }>('/examinations', {
    throwOnError: false,
    next: { revalidate: 0 },
  });
  const rows = result.data?.data ?? [];
  return rows.map(normalizeExamination);
}

/** Fetch a single examination by ID. */
export async function getExamination(id: string): Promise<Examination | null> {
  const result = await gatewayFetch<ExaminationApiRecord>(`/examinations/${id}`, {
    throwOnError: false,
    next: { revalidate: 0 },
  });
  return result.data ? normalizeExamination(result.data) : null;
}

/** Create an examination via POST /examinations (gateway → examination plugin). */
export async function createExamination(input: CreateExaminationInput): Promise<Examination> {
  const result = await gatewayFetch<ExaminationApiRecord>('/examinations', {
    method: 'POST',
    json: input,
  });
  if (!result.data) {
    throw new Error('Empty response from examination-service');
  }
  return normalizeExamination(result.data);
}

/** List candidates registered for an examination. */
export async function listExaminationCandidates(
  examinationId: string,
): Promise<ExaminationCandidate[]> {
  const result = await gatewayFetch<{ data: ExaminationCandidate[] }>(
    `/examinations/${examinationId}/candidates`,
    { throwOnError: false, next: { revalidate: 0 } },
  );
  return result.data?.data ?? [];
}

export interface RegisterCandidateInput {
  studentId: string;
  centerId: string;
  subjectIds: string[];
}

/** POST /examinations/:id/candidates — eligibility validated server-side. */
export async function registerExaminationCandidate(
  examinationId: string,
  input: RegisterCandidateInput,
): Promise<ExaminationCandidate> {
  const result = await gatewayFetch<ExaminationCandidate>(
    `/examinations/${examinationId}/candidates`,
    { method: 'POST', json: input },
  );
  if (!result.data) throw new Error('Empty response from examination-service');
  return result.data;
}

interface MarksCandidateRecord {
  id: string;
  studentId: string;
  centerId: string;
  subjectResults: Array<{ subjectId: string; score: number | null; isComplete: boolean }>;
}

interface PublicationRecord {
  publishedAt: string;
  gradeResults: Array<{
    candidateId: string;
    studentId: string;
    subjectId: string;
    score: number;
    grade: string;
    passed: boolean;
  }>;
  incompleteRecords: Array<{ candidateId: string; studentId: string; subjectId: string }>;
}

/**
 * Results tab read model: recorded marks (pre-publication) merged with the
 * publication (grades) when it exists. `GET /results` is 404 until published.
 */
export async function getExaminationResultsView(
  examination: Examination,
): Promise<ExaminationResultsView> {
  const [marks, publication] = await Promise.all([
    gatewayFetch<{ data: MarksCandidateRecord[] }>(
      `/examinations/${examination.id}/results/marks`,
      { throwOnError: false, next: { revalidate: 0 } },
    ),
    gatewayFetch<PublicationRecord>(`/examinations/${examination.id}/results`, {
      throwOnError: false,
      next: { revalidate: 0 },
    }),
  ]);
  const candidates = marks.data?.data ?? [];
  const published = publication.data ?? null;
  const gradeByKey = new Map(
    (published?.gradeResults ?? []).map((g) => [`${g.studentId}:${g.subjectId}`, g] as const),
  );
  const maxScore = examination.subjects.reduce((sum, s) => sum + s.maxScore, 0);

  const rows: ExaminationResult[] = candidates.map((candidate) => {
    const subjects = examination.subjects.map((subject) => {
      const recorded = candidate.subjectResults.find((r) => r.subjectId === subject.id);
      const graded = gradeByKey.get(`${candidate.studentId}:${subject.id}`);
      return {
        id: subject.id,
        code: subject.code,
        score: graded?.score ?? recorded?.score ?? null,
        grade: graded?.grade ?? null,
      };
    });
    const complete = subjects.every((s) => s.score !== null);
    const totalScore = complete ? subjects.reduce((sum, s) => sum + (s.score ?? 0), 0) : null;
    const hasGrades = subjects.some((s) => s.grade !== null);
    return {
      candidateId: candidate.id,
      studentId: candidate.studentId,
      centerId: candidate.centerId,
      subjects,
      totalScore,
      maxScore,
      status: hasGrades ? 'PUBLISHED' : complete ? 'PENDING' : 'INCOMPLETE',
    };
  });

  return {
    published: published !== null,
    publishedAt: published?.publishedAt ?? null,
    rows,
    subjects: examination.subjects,
  };
}

export interface RecordMarksInput {
  entries: Array<{ studentId: string; marks: Array<{ subjectId: string; score: number | null }> }>;
}

/** POST /examinations/:id/results/marks */
export async function recordExaminationMarks(
  examinationId: string,
  input: RecordMarksInput,
): Promise<{ candidateCount: number; subjectResultCount: number }> {
  const result = await gatewayFetch<{ candidateCount: number; subjectResultCount: number }>(
    `/examinations/${examinationId}/results/marks`,
    { method: 'POST', json: input },
  );
  if (!result.data) throw new Error('Empty response from examination-service');
  return result.data;
}

/** POST /examinations/:id/results/publish */
export async function publishExaminationResults(
  examinationId: string,
): Promise<{ processedCount: number; incompleteCount: number }> {
  const result = await gatewayFetch<{ processedCount: number; incompleteCount: number }>(
    `/examinations/${examinationId}/results/publish`,
    { method: 'POST' },
  );
  if (!result.data) throw new Error('Empty response from examination-service');
  return result.data;
}

interface DocumentJobRecord {
  id: string;
  documentType: ExaminationDocumentType;
  status: ExaminationDocument['status'];
  totalCandidates: number;
  processedCount: number;
  failedCount: number;
  errorMessage?: string;
  outputPath?: string;
  createdAt: string;
  completedAt?: string;
}

function toDocument(examinationId: string, job: DocumentJobRecord): ExaminationDocument {
  return {
    id: job.id,
    documentType: job.documentType,
    status: job.status,
    totalCandidates: job.totalCandidates,
    processedCount: job.processedCount,
    failedCount: job.failedCount,
    errorMessage: job.errorMessage,
    createdAt: job.createdAt,
    completedAt: job.completedAt,
    // Same-origin proxy (apps/web/src/app/api/examinations/.../download) that
    // forwards the session bearer token to the gateway.
    downloadPath:
      job.status === 'completed'
        ? `/api/examinations/${examinationId}/documents/${job.id}/download`
        : null,
  };
}

/** List document generation jobs (GET /examinations/:id/documents/jobs). */
export async function listExaminationDocuments(
  examinationId: string,
): Promise<ExaminationDocument[]> {
  const result = await gatewayFetch<{ jobs: DocumentJobRecord[] }>(
    `/examinations/${examinationId}/documents/jobs`,
    { throwOnError: false, next: { revalidate: 0 } },
  );
  return (result.data?.jobs ?? [])
    .map((job) => toDocument(examinationId, job))
    .sort((a, b) => b.createdAt.localeCompare(a.createdAt));
}

/**
 * Generate documents: enqueue the job then process it inline so the tab shows
 * a completed, downloadable job without a worker (the worker endpoint is the
 * same one RabbitMQ consumers call).
 */
export async function generateExaminationDocuments(
  examinationId: string,
  documentType: ExaminationDocumentType,
): Promise<ExaminationDocument> {
  const queued = await gatewayFetch<DocumentJobRecord>(
    `/examinations/${examinationId}/documents/generate`,
    { method: 'POST', json: { documentType } },
  );
  if (!queued.data) throw new Error('Empty response from examination-service');
  const processed = await gatewayFetch<DocumentJobRecord>(
    `/examinations/${examinationId}/documents/jobs/${queued.data.id}/process`,
    { method: 'POST', throwOnError: false },
  );
  return toDocument(examinationId, processed.data ?? queued.data);
}
