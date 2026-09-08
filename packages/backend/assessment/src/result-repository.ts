/**
 * Assessment Result Repository Interfaces
 *
 * Defines the data access contracts for assessment result operations.
 * Implementations can use Prisma, in-memory stores, or other backends.
 *
 * Requirements: 8.4, 8.5, 8.8
 */

/**
 * A single assessment result entry for a student on an assessment item.
 */
export interface AssessmentResultEntity {
  id: string;
  tenantId: string;
  studentId: string;
  assessmentItemId: string;
  subjectId: string;
  academicPeriodId: string;
  score: number;
  createdAt: Date;
  updatedAt: Date;
}

/**
 * Aggregated result for a student across all items in a subject+period.
 * Includes weighted average and assigned grade.
 */
export interface StudentSubjectResult {
  studentId: string;
  subjectId: string;
  academicPeriodId: string;
  /** Individual item scores */
  itemScores: Array<{
    assessmentItemId: string;
    score: number;
    weight: number;
    weightedScore: number;
  }>;
  /** Weighted average across all items */
  weightedAverage: number;
  /** Assigned grade based on grading scheme thresholds */
  grade: string;
  /** Grade descriptor (if available) */
  gradeDescriptor: string | null;
}

/**
 * Repository interface for assessment result data access.
 */
export interface AssessmentResultRepository {
  /** Create or update a single result entry */
  upsert(data: Omit<AssessmentResultEntity, 'createdAt' | 'updatedAt'>): Promise<AssessmentResultEntity>;

  /** Create or update multiple result entries in bulk */
  bulkUpsert(
    data: Omit<AssessmentResultEntity, 'createdAt' | 'updatedAt'>[],
  ): Promise<AssessmentResultEntity[]>;

  /** Find all results for a student in a subject+period */
  findByStudentSubjectPeriod(
    tenantId: string,
    studentId: string,
    subjectId: string,
    academicPeriodId: string,
  ): Promise<AssessmentResultEntity[]>;

  /** Find all results for a student across every subject in a period */
  findByStudentPeriod(
    tenantId: string,
    studentId: string,
    academicPeriodId: string,
  ): Promise<AssessmentResultEntity[]>;

  /** Find all results for a subject+period (all students) */
  findBySubjectPeriod(
    tenantId: string,
    subjectId: string,
    academicPeriodId: string,
  ): Promise<AssessmentResultEntity[]>;

  /** Find results by assessment item ID */
  findByAssessmentItem(
    tenantId: string,
    assessmentItemId: string,
  ): Promise<AssessmentResultEntity[]>;

  /** Delete results for a student in a subject+period */
  deleteByStudentSubjectPeriod(
    tenantId: string,
    studentId: string,
    subjectId: string,
    academicPeriodId: string,
  ): Promise<number>;
}
