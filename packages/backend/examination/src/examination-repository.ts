/**
 * Examination Repository Interface
 *
 * Defines the data access contract for examination operations.
 * Implementations can use Prisma, in-memory stores, or other backends.
 *
 * Requirements:
 * - 10.1: Examination CRUD
 * - 10.2: Candidate registration with eligibility validation
 * - 10.3: Reject ineligible candidates with error details
 */
import type { PaginationOptions, PaginatedResult } from '@proctira/common';

/**
 * Grading scheme associated with an examination.
 */
export interface ExaminationGradingScheme {
  id: string;
  examinationId: string;
  name: string;
  minScore: number;
  maxScore: number;
  passThreshold: number;
  thresholds: GradeThreshold[];
}

/**
 * Individual grade threshold within a grading scheme.
 */
export interface GradeThreshold {
  grade: string;
  minScore: number;
  maxScore: number;
  descriptor?: string;
}

/**
 * Examination subject entity.
 */
export interface ExaminationSubject {
  id: string;
  examinationId: string;
  name: string;
  code: string;
  maxScore: number;
  gradingSchemeId?: string;
}

/**
 * Examination center entity.
 */
export interface ExaminationCenter {
  id: string;
  examinationId: string;
  name: string;
  code: string;
  institutionId: string;
  capacity: number;
}

/**
 * Examination session entity.
 */
export interface ExaminationSession {
  id: string;
  examinationId: string;
  subjectId: string;
  date: string;
  startTime: string;
  endTime: string;
  centerId?: string;
}

/**
 * Examination entity as stored in the database.
 */
export interface ExaminationEntity {
  id: string;
  tenantId: string;
  name: string;
  code: string;
  description: string | null;
  academicPeriodId: string;
  startDate: string;
  endDate: string;
  status: 'DRAFT' | 'SCHEDULED' | 'IN_PROGRESS' | 'COMPLETED' | 'CANCELLED';
  subjects: ExaminationSubject[];
  centers: ExaminationCenter[];
  sessions: ExaminationSession[];
  gradingSchemes: ExaminationGradingScheme[];
  createdAt: Date;
  updatedAt: Date;
}

/**
 * Filter options for listing examinations.
 */
export interface ExaminationFilter {
  academicPeriodId?: string;
  status?: ExaminationEntity['status'];
  search?: string;
}

/**
 * Candidate registration entity.
 */
export interface CandidateRegistration {
  id: string;
  examinationId: string;
  studentId: string;
  tenantId: string;
  centerId: string;
  subjectIds: string[];
  status: 'REGISTERED' | 'CONFIRMED' | 'CANCELLED';
  registeredAt: Date;
}

/**
 * Student enrollment information used for eligibility checks.
 */
export interface StudentEnrollment {
  studentId: string;
  status: 'enrolled' | 'transferred' | 'withdrawn' | 'graduated';
  institutionId: string;
  completedSubjectCodes: string[];
}

/**
 * Repository interface for examination data access.
 */
export interface ExaminationRepository {
  /** Create a new examination */
  create(data: Omit<ExaminationEntity, 'createdAt' | 'updatedAt'>): Promise<ExaminationEntity>;

  /** Update an existing examination */
  update(id: string, tenantId: string, data: Partial<ExaminationEntity>): Promise<ExaminationEntity | null>;

  /** Find an examination by ID within a tenant */
  findById(id: string, tenantId: string): Promise<ExaminationEntity | null>;

  /** Find an examination by code within a tenant */
  findByCode(code: string, tenantId: string): Promise<ExaminationEntity | null>;

  /** List examinations with pagination and filtering */
  list(
    tenantId: string,
    filter: ExaminationFilter,
    pagination: PaginationOptions,
  ): Promise<PaginatedResult<ExaminationEntity>>;

  /** Delete an examination */
  delete(id: string, tenantId: string): Promise<boolean>;

  /** Get student enrollment information for eligibility validation */
  getStudentEnrollment(studentId: string, tenantId: string): Promise<StudentEnrollment | null>;

  /** Save a candidate registration */
  createCandidateRegistration(data: CandidateRegistration): Promise<CandidateRegistration>;

  /** Find existing candidate registration for an examination */
  findCandidateRegistration(
    examinationId: string,
    studentId: string,
    tenantId: string,
  ): Promise<CandidateRegistration | null>;

  /** List candidate registrations for an examination */
  listCandidateRegistrations(
    examinationId: string,
    tenantId: string,
  ): Promise<CandidateRegistration[]>;
}
