/**
 * Survey Repository Interfaces
 *
 * Defines the data access contracts for survey operations.
 * Implementations can use Prisma, in-memory stores, or other backends.
 *
 * Requirements: 23.1, 23.2, 23.3, 23.4, 23.5
 */
import type { PaginationOptions, PaginatedResult } from '@proctira/common';
import type {
  QuestionType,
  SurveyStatus,
  CompletionStatus,
  DropdownOption,
  TableColumn,
} from './schemas.js';

// ─── Survey Entity ───────────────────────────────────────────────────────────

/**
 * Survey entity as stored in the database.
 */
export interface SurveyEntity {
  id: string;
  tenantId: string;
  name: string;
  description: string | null;
  status: SurveyStatus;
  academicPeriodId: string | null;
  startDate: string | null;
  endDate: string | null;
  questions: QuestionEntity[];
  createdAt: Date;
  updatedAt: Date;
}

/**
 * Question entity embedded within a survey.
 */
export interface QuestionEntity {
  id: string;
  label: string;
  type: QuestionType;
  required: boolean;
  order: number;
  options?: DropdownOption[];
  columns?: TableColumn[];
  repeaterFields?: RepeaterFieldEntity[];
  validation?: QuestionValidation;
}

export interface RepeaterFieldEntity {
  label: string;
  type: 'text' | 'number' | 'date' | 'dropdown';
  required: boolean;
  options?: DropdownOption[];
}

export interface QuestionValidation {
  min?: number;
  max?: number;
  minLength?: number;
  maxLength?: number;
  pattern?: string;
}

/**
 * Filter options for listing surveys.
 */
export interface SurveyFilter {
  status?: SurveyStatus;
  search?: string;
}

/**
 * Repository interface for survey data access.
 */
export interface SurveyRepository {
  /** Create a new survey */
  create(data: Omit<SurveyEntity, 'createdAt' | 'updatedAt'>): Promise<SurveyEntity>;

  /** Update an existing survey */
  update(id: string, tenantId: string, data: Partial<Omit<SurveyEntity, 'id' | 'tenantId' | 'createdAt' | 'updatedAt'>>): Promise<SurveyEntity | null>;

  /** Find a survey by ID within a tenant */
  findById(id: string, tenantId: string): Promise<SurveyEntity | null>;

  /** Find a survey by name within a tenant */
  findByName(name: string, tenantId: string): Promise<SurveyEntity | null>;

  /** Delete a survey */
  delete(id: string, tenantId: string): Promise<boolean>;

  /** List surveys with pagination and filtering */
  list(
    tenantId: string,
    filter: SurveyFilter,
    pagination: PaginationOptions,
  ): Promise<PaginatedResult<SurveyEntity>>;
}

// ─── Distribution Record Entity ──────────────────────────────────────────────

/**
 * Distribution record tracking survey assignment to an institution.
 * Requirement 23.2, 23.4
 */
export interface DistributionRecordEntity {
  id: string;
  tenantId: string;
  surveyId: string;
  institutionId: string;
  status: CompletionStatus;
  dueDate: string | null;
  submittedAt: string | null;
  remindersSent: number;
  reminderDays: number[];
  createdAt: Date;
  updatedAt: Date;
}

/**
 * Repository interface for distribution record data access.
 */
export interface DistributionRepository {
  /** Create distribution records for multiple institutions */
  createMany(records: Omit<DistributionRecordEntity, 'createdAt' | 'updatedAt'>[]): Promise<DistributionRecordEntity[]>;

  /** Find distribution record for a specific survey and institution */
  findBySurveyAndInstitution(tenantId: string, surveyId: string, institutionId: string): Promise<DistributionRecordEntity | null>;

  /** Find all distribution records for a survey */
  findBySurvey(tenantId: string, surveyId: string): Promise<DistributionRecordEntity[]>;

  /** Find incomplete distribution records for a survey */
  findIncompleteBySurvey(tenantId: string, surveyId: string): Promise<DistributionRecordEntity[]>;

  /** Update a distribution record */
  update(id: string, tenantId: string, data: Partial<Pick<DistributionRecordEntity, 'status' | 'submittedAt' | 'remindersSent'>>): Promise<DistributionRecordEntity | null>;

  /** Count distribution records by status for a survey */
  countByStatus(tenantId: string, surveyId: string): Promise<Record<CompletionStatus, number>>;
}

// ─── Submission Entity ───────────────────────────────────────────────────────

/**
 * Survey submission entity storing responses from an institution.
 * Requirement 23.3
 */
export interface SubmissionEntity {
  id: string;
  tenantId: string;
  surveyId: string;
  institutionId: string;
  answers: AnswerEntity[];
  submittedAt: Date;
  createdAt: Date;
}

export interface AnswerEntity {
  questionId: string;
  value: unknown;
}

/**
 * Repository interface for submission data access.
 */
export interface SubmissionRepository {
  /** Create a new submission */
  create(data: Omit<SubmissionEntity, 'createdAt'>): Promise<SubmissionEntity>;

  /** Find submissions for a survey */
  findBySurvey(tenantId: string, surveyId: string): Promise<SubmissionEntity[]>;

  /** Find submission for a specific survey and institution */
  findBySurveyAndInstitution(tenantId: string, surveyId: string, institutionId: string): Promise<SubmissionEntity | null>;
}

// ─── Institution Lookup Interface ────────────────────────────────────────────

/**
 * Interface for looking up institutions based on distribution filters.
 * Requirement 23.2: Distribute based on area, type, classification.
 */
export interface InstitutionLookup {
  /** Find institution IDs matching the given filters */
  findByFilters(
    tenantId: string,
    filters: {
      areaIds?: string[];
      institutionTypeIds?: string[];
      classificationIds?: string[];
    },
  ): Promise<string[]>;

  /** Get institution metadata for aggregation grouping */
  getMetadata(tenantId: string, institutionIds: string[]): Promise<InstitutionMetadata[]>;
}

export interface InstitutionMetadata {
  id: string;
  name: string;
  areaId: string;
  areaName: string;
  typeId: string;
  typeName: string;
}
