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
  status: 'DRAFT' | 'OPEN' | 'CLOSED' | 'COMPLETED' | 'CANCELLED';
  candidateCount?: number;
  resultsPublished?: boolean;
}

export interface ExaminationCandidate {
  id: string;
  examinationId: string;
  studentId: string;
  studentName: string;
  registrationNumber: string;
  registrationDate: string;
  status: 'REGISTERED' | 'CONFIRMED' | 'WITHDRAWN';
}

export interface ExaminationResult {
  id: string;
  candidateId: string;
  studentName: string;
  registrationNumber: string;
  totalScore: number | null;
  maxScore: number;
  grade: string | null;
  status: 'PENDING' | 'PUBLISHED';
}

export interface ExaminationDocument {
  id: string;
  type: 'ADMIT_CARD' | 'SEATING_PLAN' | 'CERTIFICATE';
  title: string;
  generatedAt: string;
  downloadUrl: string;
  format: 'PDF' | 'ZIP';
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

/** List results for an examination. */
export async function listExaminationResults(examinationId: string): Promise<ExaminationResult[]> {
  const result = await gatewayFetch<{ data: ExaminationResult[] }>(
    `/examinations/${examinationId}/results`,
    { throwOnError: false, next: { revalidate: 0 } },
  );
  return result.data?.data ?? [];
}

/** List generated documents for an examination. */
export async function listExaminationDocuments(
  examinationId: string,
): Promise<ExaminationDocument[]> {
  const result = await gatewayFetch<{ data: ExaminationDocument[] }>(
    `/examinations/${examinationId}/documents`,
    { throwOnError: false, next: { revalidate: 0 } },
  );
  return result.data?.data ?? [];
}
