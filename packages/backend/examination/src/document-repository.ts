/**
 * Document Repository Interface
 *
 * Defines the data access contract for examination document generation operations.
 * Supports document job tracking, candidate data retrieval, and generated file storage.
 *
 * Requirements:
 * - 10.6: Generate examination documents (admit cards, seating plans, result certificates)
 *         as PDF files within 60 seconds per batch of up to 500 candidates
 */

/**
 * Types of examination documents that can be generated.
 */
export type DocumentType = 'admit_card' | 'seating_plan' | 'result_certificate';

/**
 * Status of a document generation job.
 */
export type DocumentJobStatus = 'queued' | 'processing' | 'completed' | 'failed';

/**
 * Candidate information needed for document generation.
 */
export interface DocumentCandidate {
  id: string;
  studentId: string;
  studentName: string;
  rollNumber: string;
  centerId: string;
  centerName: string;
  subjectIds: string[];
  subjectNames: string[];
  gender: string;
  photoUrl?: string;
}

/**
 * Seating assignment for a candidate at a center.
 */
export interface SeatingAssignment {
  candidateId: string;
  studentName: string;
  rollNumber: string;
  centerId: string;
  centerName: string;
  roomNumber: string;
  seatNumber: string;
  subjectNames: string[];
}

/**
 * Result data for certificate generation.
 */
export interface CandidateResultData {
  candidateId: string;
  studentId: string;
  studentName: string;
  rollNumber: string;
  subjects: Array<{
    name: string;
    score: number;
    grade: string;
    passed: boolean;
  }>;
  overallGrade: string;
  overallPassed: boolean;
  totalScore: number;
  maxPossibleScore: number;
}

/**
 * A document generation job.
 */
export interface DocumentGenerationJob {
  id: string;
  tenantId: string;
  examinationId: string;
  documentType: DocumentType;
  status: DocumentJobStatus;
  /** Candidate IDs to generate documents for (batch) */
  candidateIds: string[];
  /** Total candidates in this batch */
  totalCandidates: number;
  /** Number of documents successfully generated */
  processedCount: number;
  /** Number of documents that failed to generate */
  failedCount: number;
  /** Error message if the job failed */
  errorMessage?: string;
  /** URL/path to the generated PDF file */
  outputPath?: string;
  /** Duration in milliseconds */
  durationMs?: number;
  /** When the job was created */
  createdAt: Date;
  /** When the job started processing */
  startedAt?: Date;
  /** When the job completed */
  completedAt?: Date;
}

/**
 * Repository interface for document generation data access.
 */
export interface DocumentRepository {
  /** Get candidates for document generation */
  getDocumentCandidates(
    examinationId: string,
    tenantId: string,
    candidateIds?: string[],
  ): Promise<DocumentCandidate[]>;

  /** Get seating assignments for a center */
  getSeatingAssignments(
    examinationId: string,
    tenantId: string,
    centerId?: string,
  ): Promise<SeatingAssignment[]>;

  /** Get result data for certificate generation */
  getCandidateResults(
    examinationId: string,
    tenantId: string,
    candidateIds?: string[],
  ): Promise<CandidateResultData[]>;

  /** Create a document generation job */
  createJob(job: DocumentGenerationJob): Promise<DocumentGenerationJob>;

  /** Update a document generation job */
  updateJob(
    jobId: string,
    tenantId: string,
    updates: Partial<DocumentGenerationJob>,
  ): Promise<DocumentGenerationJob | null>;

  /** Get a document generation job by ID */
  getJob(jobId: string, tenantId: string): Promise<DocumentGenerationJob | null>;

  /** List document generation jobs for an examination */
  listJobs(
    examinationId: string,
    tenantId: string,
  ): Promise<DocumentGenerationJob[]>;
}
