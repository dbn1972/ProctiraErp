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

export interface Examination {
  id: string;
  name: string;
  code: string;
  examinationDate: string;
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

/** List examinations with optional status filtering. */
export async function listExaminations(): Promise<Examination[]> {
  const result = await gatewayFetch<{ data: Examination[] }>(
    '/examinations',
    { throwOnError: false, next: { revalidate: 0 } },
  );
  return result.data?.data ?? [];
}

/** Fetch a single examination by ID. */
export async function getExamination(id: string): Promise<Examination | null> {
  const result = await gatewayFetch<Examination>(`/examinations/${id}`, {
    throwOnError: false,
    next: { revalidate: 0 },
  });
  return result.data;
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
export async function listExaminationResults(
  examinationId: string,
): Promise<ExaminationResult[]> {
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
