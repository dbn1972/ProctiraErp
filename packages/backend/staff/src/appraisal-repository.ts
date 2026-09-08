/**
 * Appraisal Repository Interface
 *
 * Defines the data access contract for staff appraisal operations.
 * Requirements:
 * - 7.3: Staff appraisal workflows with configurable criteria, scoring, and approval chains
 */
import type { PaginationOptions, PaginatedResult } from '@proctira/common';

/**
 * Appraisal criterion stored in a template.
 */
export interface AppraisalCriterionEntity {
  name: string;
  description: string | null;
  weight: number;
  maxScore: number;
}

/**
 * Appraisal template entity.
 */
export interface AppraisalTemplateEntity {
  id: string;
  tenantId: string;
  name: string;
  description: string | null;
  academicPeriodId: string;
  criteria: AppraisalCriterionEntity[];
  scoreMin: number;
  scoreMax: number;
  createdAt: Date;
  updatedAt: Date;
}

/**
 * Score entry for a single criterion in an appraisal.
 */
export interface AppraisalScoreEntity {
  criterionName: string;
  score: number;
  comment: string | null;
}

/**
 * Appraisal entity as stored in the database.
 */
export interface AppraisalEntity {
  id: string;
  tenantId: string;
  staffId: string;
  templateId: string;
  appraisalDate: string;
  scores: AppraisalScoreEntity[];
  totalScore: number;
  overallComment: string | null;
  status: 'DRAFT' | 'SUBMITTED' | 'IN_REVIEW' | 'APPROVED' | 'REJECTED';
  workflowInstanceId: string | null;
  createdAt: Date;
  updatedAt: Date;
}

/**
 * Filter options for listing appraisals.
 */
export interface AppraisalFilter {
  staffId?: string;
  templateId?: string;
  status?: string;
}

/**
 * Repository interface for appraisal template data access.
 */
export interface AppraisalTemplateRepository {
  create(
    data: Omit<AppraisalTemplateEntity, 'createdAt' | 'updatedAt'>,
  ): Promise<AppraisalTemplateEntity>;
  findById(id: string, tenantId: string): Promise<AppraisalTemplateEntity | null>;
  list(
    tenantId: string,
    pagination: PaginationOptions,
  ): Promise<PaginatedResult<AppraisalTemplateEntity>>;
}

/**
 * Repository interface for appraisal data access.
 */
export interface AppraisalRepository {
  create(data: Omit<AppraisalEntity, 'createdAt' | 'updatedAt'>): Promise<AppraisalEntity>;
  findById(id: string, tenantId: string): Promise<AppraisalEntity | null>;
  update(
    id: string,
    tenantId: string,
    data: Partial<AppraisalEntity>,
  ): Promise<AppraisalEntity | null>;
  list(
    tenantId: string,
    filter: AppraisalFilter,
    pagination: PaginationOptions,
  ): Promise<PaginatedResult<AppraisalEntity>>;
}
