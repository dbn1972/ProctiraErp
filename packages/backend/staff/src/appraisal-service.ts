/**
 * Appraisal Service
 *
 * Business logic for staff appraisal operations.
 *
 * Requirements:
 * - 7.3: Staff appraisal workflows with configurable criteria, scoring on a defined
 *         numeric scale, and approval chains routed through the Workflow_Engine
 */
import { NotFoundError, BusinessRuleError } from '@proctira/common';
import type { PaginationOptions, PaginatedResult } from '@proctira/common';
import { v4 as uuidv4 } from 'uuid';

import type {
  AppraisalTemplateEntity,
  AppraisalEntity,
  AppraisalFilter,
  AppraisalTemplateRepository,
  AppraisalRepository,
} from './appraisal-repository.js';
import type { CreateAppraisalTemplateInput, CreateAppraisalInput } from './appraisal-schemas.js';
import { AppraisalStatus } from './appraisal-schemas.js';

/**
 * Interface for workflow integration.
 * The workflow engine creates an instance and returns its ID.
 */
export interface WorkflowIntegration {
  createInstance(
    tenantId: string,
    workflowType: string,
    entityType: string,
    entityId: string,
  ): Promise<string>; // Returns workflow instance ID
}

/**
 * Service handling staff appraisal business logic.
 */
export class AppraisalService {
  constructor(
    private readonly templateRepository: AppraisalTemplateRepository,
    private readonly appraisalRepository: AppraisalRepository,
    private readonly workflowIntegration?: WorkflowIntegration,
  ) {}

  /**
   * Create an appraisal template with configurable criteria.
   *
   * Validates:
   * - Criteria weights must sum to exactly 100
   * - scoreMin must be less than scoreMax
   *
   * @throws BusinessRuleError if criteria weights don't sum to 100
   */
  async createTemplate(
    tenantId: string,
    input: CreateAppraisalTemplateInput,
  ): Promise<AppraisalTemplateEntity> {
    // Validate criteria weights sum to 100
    const totalWeight = input.criteria.reduce((sum, c) => sum + c.weight, 0);
    if (totalWeight !== 100) {
      throw new BusinessRuleError(`Criteria weights must sum to 100, but got ${totalWeight}`);
    }

    // Validate scoreMin < scoreMax
    if (input.scoreMin >= input.scoreMax) {
      throw new BusinessRuleError(
        `scoreMin (${input.scoreMin}) must be less than scoreMax (${input.scoreMax})`,
      );
    }

    const template: Omit<AppraisalTemplateEntity, 'createdAt' | 'updatedAt'> = {
      id: uuidv4(),
      tenantId,
      name: input.name,
      description: input.description ?? null,
      academicPeriodId: input.academicPeriodId,
      criteria: input.criteria.map((c) => ({
        name: c.name,
        description: c.description ?? null,
        weight: c.weight,
        maxScore: c.maxScore,
      })),
      scoreMin: input.scoreMin,
      scoreMax: input.scoreMax,
    };

    return this.templateRepository.create(template);
  }

  /**
   * Get an appraisal template by ID.
   *
   * @throws NotFoundError if template not found
   */
  async getTemplate(tenantId: string, templateId: string): Promise<AppraisalTemplateEntity> {
    const template = await this.templateRepository.findById(templateId, tenantId);
    if (!template) {
      throw new NotFoundError(`Appraisal template with id '${templateId}' not found`);
    }
    return template;
  }

  /**
   * List appraisal templates.
   */
  async listTemplates(
    tenantId: string,
    pagination: PaginationOptions,
  ): Promise<PaginatedResult<AppraisalTemplateEntity>> {
    return this.templateRepository.list(tenantId, pagination);
  }

  /**
   * Create a staff appraisal with scores.
   *
   * Validates:
   * - Template exists
   * - All criteria in the template have corresponding scores
   * - Each score is within the template's score range (0 to criterion maxScore)
   *
   * @throws NotFoundError if template not found
   * @throws BusinessRuleError if scores don't match criteria or are out of range
   */
  async createAppraisal(tenantId: string, input: CreateAppraisalInput): Promise<AppraisalEntity> {
    // Validate template exists
    const template = await this.templateRepository.findById(input.templateId, tenantId);
    if (!template) {
      throw new NotFoundError(`Appraisal template with id '${input.templateId}' not found`);
    }

    // Validate all criteria are scored
    const criteriaNames = new Set(template.criteria.map((c) => c.name));
    const scoredNames = new Set(input.scores.map((s) => s.criterionName));

    for (const name of criteriaNames) {
      if (!scoredNames.has(name)) {
        throw new BusinessRuleError(`Missing score for criterion '${name}'`);
      }
    }

    for (const score of input.scores) {
      if (!criteriaNames.has(score.criterionName)) {
        throw new BusinessRuleError(
          `Unknown criterion '${score.criterionName}' - not defined in template`,
        );
      }
    }

    // Validate each score is within range
    for (const score of input.scores) {
      const criterion = template.criteria.find((c) => c.name === score.criterionName)!;
      if (score.score < 0 || score.score > criterion.maxScore) {
        throw new BusinessRuleError(
          `Score for '${score.criterionName}' must be between 0 and ${criterion.maxScore}, got ${score.score}`,
        );
      }
    }

    // Calculate total weighted score
    const totalScore = this.calculateTotalScore(template, input.scores);

    const appraisal: Omit<AppraisalEntity, 'createdAt' | 'updatedAt'> = {
      id: uuidv4(),
      tenantId,
      staffId: input.staffId,
      templateId: input.templateId,
      appraisalDate: input.appraisalDate,
      scores: input.scores.map((s) => ({
        criterionName: s.criterionName,
        score: s.score,
        comment: s.comment ?? null,
      })),
      totalScore,
      overallComment: input.overallComment ?? null,
      status: AppraisalStatus.DRAFT,
      workflowInstanceId: null,
    };

    return this.appraisalRepository.create(appraisal);
  }

  /**
   * Get an appraisal by ID.
   *
   * @throws NotFoundError if appraisal not found
   */
  async getAppraisal(tenantId: string, id: string): Promise<AppraisalEntity> {
    const appraisal = await this.appraisalRepository.findById(id, tenantId);
    if (!appraisal) {
      throw new NotFoundError(`Appraisal with id '${id}' not found`);
    }
    return appraisal;
  }

  /**
   * List appraisals with filtering.
   */
  async listAppraisals(
    tenantId: string,
    filter: AppraisalFilter,
    pagination: PaginationOptions,
  ): Promise<PaginatedResult<AppraisalEntity>> {
    return this.appraisalRepository.list(tenantId, filter, pagination);
  }

  /**
   * Submit an appraisal for workflow approval.
   * Transitions status from DRAFT to SUBMITTED and creates a workflow instance.
   *
   * @throws NotFoundError if appraisal not found
   * @throws BusinessRuleError if appraisal is not in DRAFT status
   */
  async submitAppraisal(tenantId: string, id: string): Promise<AppraisalEntity> {
    const appraisal = await this.appraisalRepository.findById(id, tenantId);
    if (!appraisal) {
      throw new NotFoundError(`Appraisal with id '${id}' not found`);
    }

    if (appraisal.status !== AppraisalStatus.DRAFT) {
      throw new BusinessRuleError(
        `Appraisal can only be submitted from DRAFT status, current status is '${appraisal.status}'`,
      );
    }

    let workflowInstanceId: string | null = null;

    // Integrate with workflow engine if available
    if (this.workflowIntegration) {
      workflowInstanceId = await this.workflowIntegration.createInstance(
        tenantId,
        'staff_appraisal',
        'appraisal',
        id,
      );
    }

    const updated = await this.appraisalRepository.update(id, tenantId, {
      status: AppraisalStatus.SUBMITTED,
      workflowInstanceId,
    });

    if (!updated) {
      throw new NotFoundError(`Appraisal with id '${id}' not found`);
    }

    return updated;
  }

  /**
   * Calculate the total weighted score for an appraisal.
   * Formula: sum of (score / maxScore * weight) for each criterion,
   * then scaled to the template's score range.
   */
  private calculateTotalScore(
    template: AppraisalTemplateEntity,
    scores: Array<{ criterionName: string; score: number }>,
  ): number {
    let weightedSum = 0;

    for (const scoreEntry of scores) {
      const criterion = template.criteria.find((c) => c.name === scoreEntry.criterionName);
      if (!criterion) continue;

      // Normalized score (0 to 1) * weight
      const normalizedScore = scoreEntry.score / criterion.maxScore;
      weightedSum += normalizedScore * criterion.weight;
    }

    // Scale to template's score range
    // weightedSum is 0-100 (since weights sum to 100)
    const range = template.scoreMax - template.scoreMin;
    const totalScore = template.scoreMin + (weightedSum / 100) * range;

    // Round to 2 decimal places
    return Math.round(totalScore * 100) / 100;
  }
}
