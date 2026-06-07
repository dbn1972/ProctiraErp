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

/**
 * Gender type for candidates.
 */
export type CandidateGender = 'male' | 'female' | 'other';

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

  /** Save publication result */
  savePublicationResult(result: PublicationResult): Promise<void>;

  /** Get publication result for an examination */
  getPublicationResult(examinationId: string, tenantId: string): Promise<PublicationResult | null>;

  /** Update student academic records in batch */
  updateAcademicRecords(tenantId: string, updates: AcademicRecordUpdate[]): Promise<void>;

  /** Save result analysis */
  saveResultAnalysis(analysis: ResultAnalysis): Promise<void>;

  /** Get result analysis for an examination */
  getResultAnalysis(examinationId: string, tenantId: string): Promise<ResultAnalysis | null>;
}
