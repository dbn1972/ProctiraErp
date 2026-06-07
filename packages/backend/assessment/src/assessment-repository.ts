/**
 * Assessment Repository Interfaces
 *
 * Defines the data access contracts for assessment operations.
 * Implementations can use Prisma, in-memory stores, or other backends.
 *
 * Requirements: 8.1, 8.2, 8.6
 */
import type { PaginationOptions, PaginatedResult } from '@proctira/common';
import type { GradingSchemeType, GradeThreshold } from './schemas.js';

// ─── Grading Scheme ──────────────────────────────────────────────────────────

/**
 * Grading scheme entity as stored in the database.
 */
export interface GradingSchemeEntity {
  id: string;
  tenantId: string;
  name: string;
  type: GradingSchemeType;
  minValue: number;
  maxValue: number;
  thresholds: GradeThreshold[];
  createdAt: Date;
  updatedAt: Date;
}

/**
 * Filter options for listing grading schemes.
 */
export interface GradingSchemeFilter {
  type?: GradingSchemeType;
  search?: string;
}

/**
 * Repository interface for grading scheme data access.
 */
export interface GradingSchemeRepository {
  /** Create a new grading scheme */
  create(data: Omit<GradingSchemeEntity, 'createdAt' | 'updatedAt'>): Promise<GradingSchemeEntity>;

  /** Update an existing grading scheme */
  update(id: string, tenantId: string, data: Partial<GradingSchemeEntity>): Promise<GradingSchemeEntity | null>;

  /** Find a grading scheme by ID within a tenant */
  findById(id: string, tenantId: string): Promise<GradingSchemeEntity | null>;

  /** Find a grading scheme by name within a tenant */
  findByName(name: string, tenantId: string): Promise<GradingSchemeEntity | null>;

  /** Delete a grading scheme */
  delete(id: string, tenantId: string): Promise<boolean>;

  /** List grading schemes with pagination and filtering */
  list(
    tenantId: string,
    filter: GradingSchemeFilter,
    pagination: PaginationOptions,
  ): Promise<PaginatedResult<GradingSchemeEntity>>;
}

// ─── Assessment Item ─────────────────────────────────────────────────────────

/**
 * Assessment item entity as stored in the database.
 */
export interface AssessmentItemEntity {
  id: string;
  tenantId: string;
  subjectId: string;
  academicPeriodId: string;
  gradingSchemeId: string;
  name: string;
  weight: number;
  maxScore: number;
  minScore: number;
  outcomeIds: string[];
  createdAt: Date;
  updatedAt: Date;
}

/**
 * Repository interface for assessment item data access.
 */
export interface AssessmentItemRepository {
  /** Create multiple assessment items (replaces existing items for the subject+period) */
  replaceItemsForSubjectPeriod(
    tenantId: string,
    subjectId: string,
    academicPeriodId: string,
    items: Omit<AssessmentItemEntity, 'createdAt' | 'updatedAt'>[],
  ): Promise<AssessmentItemEntity[]>;

  /** Find all assessment items for a subject in an academic period */
  findBySubjectAndPeriod(
    tenantId: string,
    subjectId: string,
    academicPeriodId: string,
  ): Promise<AssessmentItemEntity[]>;

  /** Count items for a subject in an academic period */
  countBySubjectAndPeriod(
    tenantId: string,
    subjectId: string,
    academicPeriodId: string,
  ): Promise<number>;

  /** Find a single assessment item by ID */
  findById(id: string, tenantId: string): Promise<AssessmentItemEntity | null>;
}

// ─── Curriculum Outcome ──────────────────────────────────────────────────────

/**
 * Curriculum outcome entity as stored in the database.
 */
export interface OutcomeEntity {
  id: string;
  tenantId: string;
  name: string;
  code: string;
  description: string | null;
  subjectId: string;
  createdAt: Date;
  updatedAt: Date;
}

/**
 * Repository interface for curriculum outcome data access.
 */
export interface OutcomeRepository {
  /** Create a new outcome */
  create(data: Omit<OutcomeEntity, 'createdAt' | 'updatedAt'>): Promise<OutcomeEntity>;

  /** Find an outcome by ID within a tenant */
  findById(id: string, tenantId: string): Promise<OutcomeEntity | null>;

  /** Find outcomes by IDs within a tenant */
  findByIds(ids: string[], tenantId: string): Promise<OutcomeEntity[]>;

  /** Find all outcomes for a subject */
  findBySubject(tenantId: string, subjectId: string): Promise<OutcomeEntity[]>;

  /** Delete an outcome */
  delete(id: string, tenantId: string): Promise<boolean>;
}
