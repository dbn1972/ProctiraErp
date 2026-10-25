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
import { MAX_API_PAGE_SIZE } from './pagination';
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
  /** Backend registration status is REGISTERED | CONFIRMED | CANCELLED. */
  status: 'REGISTERED' | 'CONFIRMED' | 'CANCELLED' | 'WITHDRAWN';
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
  const result = await gatewayFetch<ExaminationApiRecord>(
    `/examinations/${encodeURIComponent(id)}`,
    {
      throwOnError: false,
      next: { revalidate: 0 },
    },
  );
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
    `/examinations/${encodeURIComponent(examinationId)}/candidates`,
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
    `/examinations/${encodeURIComponent(examinationId)}/candidates`,
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
  // PRC-M243: the route paginates this field (`{ data, meta }`), not a bare
  // array — getExaminationResultsView below reads every page via
  // fetchAllPublicationGradeResults rather than destructuring it directly.
  gradeResults: {
    data: Array<{
      candidateId: string;
      studentId: string;
      subjectId: string;
      score: number;
      grade: string;
      passed: boolean;
    }>;
    meta: { page: number; pageSize: number; totalItems: number; totalPages: number };
  };
  incompleteRecords: Array<{ candidateId: string; studentId: string; subjectId: string }>;
}

/** Bounded like `gatewayFetchAllPages`'s `MAX_AUTO_PAGES` — a hard stop so a bad `totalPages` cannot loop forever. */
const MAX_GRADE_RESULT_PAGES = 50;

/**
 * Fetches every page of a publication's `gradeResults` (PRC-M243 made the
 * field `{ data, meta }`-paginated rather than a bare array). Unlike
 * `gatewayFetchAllPages`, the paginated field is nested inside a response
 * that also carries `publishedAt`/`incompleteRecords`/etc., so the whole
 * response is fetched once per page and only `gradeResults.data` collected —
 * `gatewayFetchAllPages` assumes the top-level body itself is `{ data, meta }`
 * and doesn't fit this shape.
 */
async function fetchAllPublicationGradeResults(
  examinationId: string,
): Promise<PublicationRecord['gradeResults']['data']> {
  const items: PublicationRecord['gradeResults']['data'] = [];
  for (let page = 1; page <= MAX_GRADE_RESULT_PAGES; page += 1) {
    const result = await gatewayFetch<PublicationRecord>(
      `/examinations/${encodeURIComponent(examinationId)}/results?page=${page}&pageSize=${MAX_API_PAGE_SIZE}`,
      { throwOnError: false, next: { revalidate: 0 } },
    );
    if (!result.data) break;
    items.push(...result.data.gradeResults.data);
    const totalPages = result.data.gradeResults.meta.totalPages;
    if (!totalPages || page >= totalPages) break;
  }
  return items;
}

/**
 * Results tab read model: recorded marks (pre-publication) merged with the
 * publication (grades) when it exists. `GET /results` is 404 until published.
 */
export async function getExaminationResultsView(
  examination: Examination,
): Promise<ExaminationResultsView> {
  const [marks, publication, registrations, allGradeResults] = await Promise.all([
    gatewayFetch<{ data: MarksCandidateRecord[] }>(
      `/examinations/${encodeURIComponent(examination.id)}/results/marks`,
      { throwOnError: false, next: { revalidate: 0 } },
    ),
    gatewayFetch<PublicationRecord>(`/examinations/${encodeURIComponent(examination.id)}/results`, {
      throwOnError: false,
      next: { revalidate: 0 },
    }),
    listExaminationCandidates(examination.id),
    fetchAllPublicationGradeResults(examination.id),
  ]);
  const markRows = marks.data?.data ?? [];
  const published = publication.data ?? null;
  // `published` only tells us a publication exists (for `publishedAt` below);
  // the grade rows themselves come from `allGradeResults`, which already
  // paged through every `gradeResults` page rather than just the first.
  const gradeByKey = new Map(
    (published ? allGradeResults : []).map((g) => [`${g.studentId}:${g.subjectId}`, g] as const),
  );
  const subjectById = new Map(examination.subjects.map((s) => [s.id, s] as const));
  const allExamSubjectIds = examination.subjects.map((s) => s.id);
  const registrationByStudent = new Map(registrations.map((r) => [r.studentId, r] as const));
  const isCancelled = (r: ExaminationCandidate | undefined) =>
    r?.status === 'CANCELLED' || r?.status === 'WITHDRAWN';

  // PRC-M145 / PRC-H056: mirror result-publication-service. The candidate
  // population is the non-cancelled registrations plus legacy marks rows with no
  // registration, and each candidate's required subjects are the registration
  // `subjectIds` (not the subjects that happen to have marks rows). A registered
  // subject with no marks row keeps the candidate INCOMPLETE; a marks row with no
  // registration falls back to every exam subject, as the backend does.
  const population: Array<{
    candidateId: string;
    studentId: string;
    centerId: string;
    requiredSubjectIds: string[];
    subjectResults: MarksCandidateRecord['subjectResults'];
  }> = [];
  const markedStudentIds = new Set(markRows.map((c) => c.studentId));
  for (const candidate of markRows) {
    const registration = registrationByStudent.get(candidate.studentId);
    if (isCancelled(registration)) continue;
    population.push({
      candidateId: candidate.id,
      studentId: candidate.studentId,
      centerId: candidate.centerId,
      requiredSubjectIds: registration ? registration.subjectIds : allExamSubjectIds,
      subjectResults: candidate.subjectResults,
    });
  }
  for (const registration of registrations) {
    if (isCancelled(registration) || markedStudentIds.has(registration.studentId)) continue;
    population.push({
      candidateId: registration.id,
      studentId: registration.studentId,
      centerId: registration.centerId,
      requiredSubjectIds: registration.subjectIds,
      subjectResults: [],
    });
  }

  const rows: ExaminationResult[] = population.map((candidate) => {
    const requiredIds = [...new Set(candidate.requiredSubjectIds)].filter((id) =>
      subjectById.has(id),
    );
    const subjects = requiredIds.map((subjectId) => {
      const subject = subjectById.get(subjectId)!;
      const recorded = candidate.subjectResults.find((r) => r.subjectId === subject.id);
      const graded = gradeByKey.get(`${candidate.studentId}:${subject.id}`);
      return {
        id: subject.id,
        code: subject.code,
        score: graded?.score ?? recorded?.score ?? null,
        grade: graded?.grade ?? null,
      };
    });
    const maxScore = requiredIds.reduce((sum, id) => sum + (subjectById.get(id)?.maxScore ?? 0), 0);
    const complete = subjects.length > 0 && subjects.every((s) => s.score !== null);
    const totalScore = complete ? subjects.reduce((sum, s) => sum + (s.score ?? 0), 0) : null;
    const hasGrades = subjects.some((s) => s.grade !== null);
    return {
      candidateId: candidate.candidateId,
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
    `/examinations/${encodeURIComponent(examinationId)}/results/marks`,
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
    `/examinations/${encodeURIComponent(examinationId)}/results/publish`,
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
        ? `/api/examinations/${encodeURIComponent(examinationId)}/documents/${encodeURIComponent(job.id)}/download`
        : null,
  };
}

/** List document generation jobs (GET /examinations/:id/documents/jobs). */
export async function listExaminationDocuments(
  examinationId: string,
): Promise<ExaminationDocument[]> {
  const result = await gatewayFetch<{ jobs: DocumentJobRecord[] }>(
    `/examinations/${encodeURIComponent(examinationId)}/documents/jobs`,
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
  const queued = await gatewayFetch<DocumentJobRecord & { jobIds?: string[] }>(
    `/examinations/${encodeURIComponent(examinationId)}/documents/generate`,
    { method: 'POST', json: { documentType } },
  );
  if (!queued.data) throw new Error('Empty response from examination-service');
  // PRC-M236: large exams are split into chunk jobs of ≤500 candidates; process each.
  const jobIds = queued.data.jobIds?.length ? queued.data.jobIds : [queued.data.id];
  let first: DocumentJobRecord | null = null;
  for (const jobId of jobIds) {
    const processed = await gatewayFetch<DocumentJobRecord>(
      `/examinations/${encodeURIComponent(examinationId)}/documents/jobs/${encodeURIComponent(jobId)}/process`,
      { method: 'POST', throwOnError: false },
    );
    first ??= processed.data ?? null;
  }
  return toDocument(examinationId, first ?? queued.data);
}

export interface ExamOpsSession {
  id: string;
  examinationId: string;
  subjectId: string;
  date: string;
  startTime: string;
  endTime: string;
  roomId: string;
  centerId: string | null;
}

export interface ExamOpsInvigilator {
  id: string;
  sessionId: string;
  staffId: string;
  allocatedAt: string;
}

export interface ExamOpsSeat {
  id: string;
  candidateId: string;
  studentName: string;
  rollNumber: string;
  centerName: string;
  roomNumber: string;
  seatNumber: string;
}

export interface ExamOpsMarksPair {
  candidateId: string;
  subjectId: string;
  entry1: { marks: number; enteredBy: string } | null;
  entry2: { marks: number; enteredBy: string } | null;
  varianceFlag: boolean;
  variance: number | null;
  finalMarks: number | null;
  resolved: boolean;
}

export interface ExamOpsReevaluation {
  id: string;
  candidateId: string;
  subjectId: string;
  status: 'requested' | 'assigned' | 'completed' | 'rejected';
  evaluatorId: string | null;
  originalMarks: number | null;
  revisedMarks: number | null;
  notes: string | null;
}

export async function listExamSessions(examinationId: string): Promise<ExamOpsSession[]> {
  const result = await gatewayFetch<{ data: ExamOpsSession[] }>(
    `/examinations/${encodeURIComponent(examinationId)}/sessions`,
    { throwOnError: false, next: { revalidate: 0 } },
  );
  return result.data?.data ?? [];
}

export async function createExamSession(
  examinationId: string,
  input: {
    subjectId: string;
    date: string;
    startTime: string;
    endTime: string;
    roomId: string;
    centerId?: string;
  },
): Promise<ExamOpsSession> {
  const result = await gatewayFetch<ExamOpsSession>(
    `/examinations/${encodeURIComponent(examinationId)}/sessions`,
    {
      method: 'POST',
      json: input,
    },
  );
  if (!result.data) throw new Error('Empty response from examination-service');
  return result.data;
}

export async function allocateExamInvigilator(
  examinationId: string,
  sessionId: string,
  staffId: string,
): Promise<ExamOpsInvigilator> {
  const result = await gatewayFetch<ExamOpsInvigilator>(
    `/examinations/${encodeURIComponent(examinationId)}/sessions/${encodeURIComponent(sessionId)}/invigilators`,
    { method: 'POST', json: { staffId } },
  );
  if (!result.data) throw new Error('Empty response from examination-service');
  return result.data;
}

export async function listExamInvigilators(
  examinationId: string,
  sessionId: string,
): Promise<ExamOpsInvigilator[]> {
  const result = await gatewayFetch<{ data: ExamOpsInvigilator[] }>(
    `/examinations/${encodeURIComponent(examinationId)}/sessions/${encodeURIComponent(sessionId)}/invigilators`,
    { throwOnError: false, next: { revalidate: 0 } },
  );
  return result.data?.data ?? [];
}

export async function listExamSeating(examinationId: string): Promise<ExamOpsSeat[]> {
  const result = await gatewayFetch<{ data: ExamOpsSeat[] }>(
    `/examinations/${encodeURIComponent(examinationId)}/seating`,
    { throwOnError: false, next: { revalidate: 0 } },
  );
  return result.data?.data ?? [];
}

export async function generateExamSeating(examinationId: string): Promise<ExamOpsSeat[]> {
  const result = await gatewayFetch<{ data: ExamOpsSeat[] }>(
    `/examinations/${encodeURIComponent(examinationId)}/seating/generate`,
    { method: 'POST', json: {} },
  );
  return result.data?.data ?? [];
}

export async function listExamMarksPairs(examinationId: string): Promise<ExamOpsMarksPair[]> {
  const result = await gatewayFetch<{ data: ExamOpsMarksPair[] }>(
    `/examinations/${encodeURIComponent(examinationId)}/marks/entries`,
    { throwOnError: false, next: { revalidate: 0 } },
  );
  return result.data?.data ?? [];
}

export async function recordExamDoubleEntry(
  examinationId: string,
  input: { candidateId: string; subjectId: string; entryNo: 1 | 2; marks: number },
): Promise<{ varianceFlag: boolean }> {
  const result = await gatewayFetch<{ varianceFlag: boolean }>(
    `/examinations/${encodeURIComponent(examinationId)}/marks/entries`,
    { method: 'POST', json: input },
  );
  if (!result.data) throw new Error('Empty response from examination-service');
  return result.data;
}

export async function resolveExamMarks(
  examinationId: string,
  input: { candidateId: string; subjectId: string; finalMarks: number },
): Promise<ExamOpsMarksPair> {
  const result = await gatewayFetch<ExamOpsMarksPair>(
    `/examinations/${encodeURIComponent(examinationId)}/marks/resolve`,
    { method: 'POST', json: input },
  );
  if (!result.data) throw new Error('Empty response from examination-service');
  return result.data;
}

export async function listExamReevaluations(examinationId: string): Promise<ExamOpsReevaluation[]> {
  const result = await gatewayFetch<{ data: ExamOpsReevaluation[] }>(
    `/examinations/${encodeURIComponent(examinationId)}/reevaluations`,
    { throwOnError: false, next: { revalidate: 0 } },
  );
  return result.data?.data ?? [];
}

export async function createExamReevaluation(
  examinationId: string,
  input: { candidateId: string; subjectId: string; originalMarks?: number; notes?: string },
): Promise<ExamOpsReevaluation> {
  const result = await gatewayFetch<ExamOpsReevaluation>(
    `/examinations/${encodeURIComponent(examinationId)}/reevaluations`,
    { method: 'POST', json: input },
  );
  if (!result.data) throw new Error('Empty response from examination-service');
  return result.data;
}

export async function assignExamReevaluation(
  examinationId: string,
  requestId: string,
  evaluatorId: string,
): Promise<ExamOpsReevaluation> {
  const result = await gatewayFetch<ExamOpsReevaluation>(
    `/examinations/${encodeURIComponent(examinationId)}/reevaluations/${encodeURIComponent(requestId)}/assign`,
    { method: 'POST', json: { evaluatorId } },
  );
  if (!result.data) throw new Error('Empty response from examination-service');
  return result.data;
}

export async function completeExamReevaluation(
  examinationId: string,
  requestId: string,
  revisedMarks: number,
  notes?: string,
): Promise<ExamOpsReevaluation> {
  const result = await gatewayFetch<ExamOpsReevaluation>(
    `/examinations/${encodeURIComponent(examinationId)}/reevaluations/${encodeURIComponent(requestId)}/complete`,
    { method: 'POST', json: { revisedMarks, notes } },
  );
  if (!result.data) throw new Error('Empty response from examination-service');
  return result.data;
}
