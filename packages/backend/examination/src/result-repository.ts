/**
 * Result Repository Interface
 *
 * Defines the data access contract for examination result operations.
 * Supports result storage, candidate result retrieval, and academic record updates.
 *
 * Requirements:
 * - 10.4: Calculate final grades and update student academic records within 30 seconds
 * - 10.5: Handle incomplete result data (skip, flag, continue)
 * - 10.8: Provide result analysis (pass rate, mean score, score distribution)
 */
import { createHash } from 'node:crypto';

/**
 * Gender type for candidates.
 */
export type CandidateGender = 'male' | 'female' | 'other' | 'unknown';

/**
 * PRC-M240: examination_candidates.area_id is NOT NULL, so an unresolved area is
 * stored as this nil-UUID sentinel and reported as the 'unknown' bucket — never
 * defaulted to the exam centre.
 */
export const UNKNOWN_AREA_ID = '00000000-0000-0000-0000-000000000000';

/** PRC-M240: map a student-record gender value onto the analysis buckets. */
export function normalizeCandidateGender(raw: string | null | undefined): CandidateGender {
  const v = (raw ?? '').trim().toLowerCase();
  if (v === 'm' || v === 'male') return 'male';
  if (v === 'f' || v === 'female') return 'female';
  if (v === 'o' || v === 'other' || v === 'non-binary' || v === 'nonbinary') return 'other';
  return 'unknown';
}

/**
 * A candidate's result for a single subject in an examination.
 */
export interface CandidateSubjectResult {
  candidateId: string;
  subjectId: string;
  score: number | null;
  /** Whether the score data is complete */
  isComplete: boolean;
}

/**
 * A candidate registered for an examination.
 */
export interface ExaminationCandidate {
  id: string;
  examinationId: string;
  studentId: string;
  centerId: string;
  gender: CandidateGender;
  areaId: string;
  /** Subject results for this candidate */
  subjectResults: CandidateSubjectResult[];
}

/**
 * Computed grade result for a candidate-subject pair.
 */
export interface CandidateGradeResult {
  candidateId: string;
  studentId: string;
  subjectId: string;
  score: number;
  grade: string;
  passed: boolean;
}

/**
 * Record flagged as incomplete during publication.
 */
export interface IncompleteRecord {
  candidateId: string;
  studentId: string;
  subjectId: string;
  reason: string;
}

/**
 * Publication result summary.
 */
export interface PublicationResult {
  examinationId: string;
  tenantId: string;
  publishedAt: Date;
  totalCandidates: number;
  processedCount: number;
  incompleteCount: number;
  gradeResults: CandidateGradeResult[];
  incompleteRecords: IncompleteRecord[];
  /** Duration in milliseconds */
  durationMs: number;
}

/**
 * Score distribution bucket for analysis.
 */
export interface ScoreDistributionBucket {
  rangeLabel: string;
  minScore: number;
  maxScore: number;
  count: number;
  percentage: number;
}

/**
 * Result analysis breakdown by a dimension.
 */
export interface AnalysisBreakdown {
  dimensionId: string;
  dimensionName: string;
  totalCandidates: number;
  passCount: number;
  failCount: number;
  passRate: number;
  meanScore: number;
  scoreDistribution: ScoreDistributionBucket[];
}

/**
 * Complete result analysis for an examination.
 */
export interface ResultAnalysis {
  examinationId: string;
  tenantId: string;
  generatedAt: Date;
  overall: {
    totalCandidates: number;
    passCount: number;
    failCount: number;
    incompleteCount: number;
    passRate: number;
    meanScore: number;
    scoreDistribution: ScoreDistributionBucket[];
  };
  bySubject: AnalysisBreakdown[];
  byCenter: AnalysisBreakdown[];
  byGender: AnalysisBreakdown[];
  byArea: AnalysisBreakdown[];
}

/**
 * Student academic record update payload.
 */
export interface AcademicRecordUpdate {
  studentId: string;
  examinationId: string;
  subjectId: string;
  score: number;
  grade: string;
  passed: boolean;
  publishedAt: Date;
}

/**
 * Repository interface for examination result data access.
 */
export interface ResultRepository {
  /** Get all candidates for an examination */
  getCandidates(examinationId: string, tenantId: string): Promise<ExaminationCandidate[]>;

  /**
   * Upsert candidate rows (marks entry before publication, G-902). Keyed by
   * (examinationId, studentId); replaces subjectResults for those candidates.
   */
  upsertCandidates(tenantId: string, candidates: ExaminationCandidate[]): Promise<void>;
  /**
   * PRC-M239: marks entry. In ONE tenant transaction, under a row lock on the
   * examination: reject if results are published, then merge each candidate's
   * subject results per subject into the stored row (concurrent entries for
   * different subjects of the same student are both kept).
   */
  mergeCandidateMarks(
    tenantId: string,
    examinationId: string,
    candidates: ExaminationCandidate[],
  ): Promise<void>;

  /**
   * Delete candidate rows keyed by (examinationId, studentId). Used by PRC-H057
   * marks-unit compensation when the unit itself created the candidate row.
   */
  deleteCandidates(tenantId: string, examinationId: string, studentIds: string[]): Promise<void>;

  /** Save publication result */
  /**
   * PRC-M239: with `candidatesFingerprint`, the save locks the examination and
   * fails with 409 if marks changed since the snapshot the result was built from.
   */
  savePublicationResult(
    result: PublicationResult,
    options?: { candidatesFingerprint?: string },
  ): Promise<void>;

  /** Get publication result for an examination */
  getPublicationResult(examinationId: string, tenantId: string): Promise<PublicationResult | null>;

  /** Update student academic records in batch */
  updateAcademicRecords(tenantId: string, updates: AcademicRecordUpdate[]): Promise<void>;

  /** Save result analysis */
  saveResultAnalysis(analysis: ResultAnalysis): Promise<void>;

  /** Get result analysis for an examination */
  getResultAnalysis(examinationId: string, tenantId: string): Promise<ResultAnalysis | null>;
}

/** PRC-M239: marks are locked once results are published. */
export const MARKS_LOCKED_MESSAGE =
  'Results are already published for this examination; marks are locked';

/** PRC-M239: per-subject merge (incoming subjects replace stored ones). */
export function mergeSubjectResults(
  stored: CandidateSubjectResult[],
  incoming: CandidateSubjectResult[],
  candidateId: string,
): CandidateSubjectResult[] {
  const bySubject = new Map(stored.map((r) => [r.subjectId, { ...r, candidateId }] as const));
  for (const r of incoming) bySubject.set(r.subjectId, { ...r, candidateId });
  return [...bySubject.values()];
}

/** PRC-M239: order-independent fingerprint of the candidate marks snapshot. */
export function fingerprintCandidates(candidates: ExaminationCandidate[]): string {
  const normalized = [...candidates]
    .map((c) => ({
      s: c.studentId,
      r: [...c.subjectResults]
        .map((r) => [r.subjectId, r.score, r.isComplete] as const)
        .sort((a, b) => a[0].localeCompare(b[0])),
    }))
    .sort((a, b) => a.s.localeCompare(b.s));
  return createHash('sha256').update(JSON.stringify(normalized)).digest('hex');
}
