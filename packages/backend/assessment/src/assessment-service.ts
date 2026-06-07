/**
 * Assessment Service
 *
 * Business logic for assessment operations including:
 * - Grading scheme CRUD with validation
 * - Assessment item definition with weight validation (sum must equal 100%)
 * - Outcome-based assessment mapping
 *
 * Requirements:
 * - 8.1: Configurable grading schemes (numeric, letter, competency)
 * - 8.2: Up to 50 items per subject per period, weights sum to 100%
 * - 8.3: Reject if weights don't sum to 100%
 * - 8.6: Outcome-based assessment mapping
 */
import {
  ConflictError,
  NotFoundError,
  BusinessRuleError,
  ValidationError,
} from '@proctira/common';
import type { PaginationOptions, PaginatedResult, FieldError } from '@proctira/common';
import { v4 as uuidv4 } from 'uuid';

import type {
  GradingSchemeEntity,
  GradingSchemeFilter,
  GradingSchemeRepository,
  AssessmentItemEntity,
  AssessmentItemRepository,
  OutcomeEntity,
  OutcomeRepository,
} from './assessment-repository.js';
import type {
  CreateGradingSchemeInput,
  UpdateGradingSchemeInput,
  DefineAssessmentItemsInput,
  CreateOutcomeInput,
  GradeThreshold,
} from './schemas.js';

/** Maximum number of assessment items per subject per academic period */
export const MAX_ITEMS_PER_SUBJECT_PERIOD = 50;

/** Required total weight for assessment items (100%) */
export const REQUIRED_WEIGHT_TOTAL = 100;

/**
 * Service handling assessment business logic.
 */
export class AssessmentService {
  constructor(
    private readonly gradingSchemeRepo: GradingSchemeRepository,
    private readonly assessmentItemRepo: AssessmentItemRepository,
    private readonly outcomeRepo: OutcomeRepository,
  ) {}

  // ─── Grading Scheme Operations ───────────────────────────────────────────

  /**
   * Create a new grading scheme.
   *
   * Validates:
   * - Name is unique within tenant
   * - minValue < maxValue
   * - Thresholds are valid and cover the score range
   *
   * @throws ConflictError if name already exists
   * @throws BusinessRuleError if minValue >= maxValue or thresholds are invalid
   */
  async createGradingScheme(
    tenantId: string,
    input: CreateGradingSchemeInput,
  ): Promise<GradingSchemeEntity> {
    // Validate min < max
    if (input.minValue >= input.maxValue) {
      throw new BusinessRuleError(
        'Minimum value must be less than maximum value',
      );
    }

    // Validate thresholds
    this.validateThresholds(input.thresholds, input.minValue, input.maxValue);

    // Check name uniqueness within tenant
    const existing = await this.gradingSchemeRepo.findByName(input.name, tenantId);
    if (existing) {
      throw new ConflictError(
        `Grading scheme with name '${input.name}' already exists`,
      );
    }

    const entity: Omit<GradingSchemeEntity, 'createdAt' | 'updatedAt'> = {
      id: uuidv4(),
      tenantId,
      name: input.name,
      type: input.type,
      minValue: input.minValue,
      maxValue: input.maxValue,
      thresholds: input.thresholds,
    };

    return this.gradingSchemeRepo.create(entity);
  }

  /**
   * Update an existing grading scheme.
   *
   * @throws NotFoundError if scheme not found
   * @throws ConflictError if new name conflicts
   * @throws BusinessRuleError if thresholds are invalid
   */
  async updateGradingScheme(
    tenantId: string,
    id: string,
    input: UpdateGradingSchemeInput,
  ): Promise<GradingSchemeEntity> {
    const existing = await this.gradingSchemeRepo.findById(id, tenantId);
    if (!existing) {
      throw new NotFoundError(`Grading scheme with id '${id}' not found`);
    }

    // If name is changing, check uniqueness
    if (input.name && input.name !== existing.name) {
      const byName = await this.gradingSchemeRepo.findByName(input.name, tenantId);
      if (byName) {
        throw new ConflictError(
          `Grading scheme with name '${input.name}' already exists`,
        );
      }
    }

    const newMinValue = input.minValue ?? existing.minValue;
    const newMaxValue = input.maxValue ?? existing.maxValue;

    // Validate min < max
    if (newMinValue >= newMaxValue) {
      throw new BusinessRuleError(
        'Minimum value must be less than maximum value',
      );
    }

    // Validate thresholds if provided
    const newThresholds = input.thresholds ?? existing.thresholds;
    this.validateThresholds(newThresholds, newMinValue, newMaxValue);

    const updateData: Partial<GradingSchemeEntity> = {};
    if (input.name !== undefined) updateData.name = input.name;
    if (input.type !== undefined) updateData.type = input.type;
    if (input.minValue !== undefined) updateData.minValue = input.minValue;
    if (input.maxValue !== undefined) updateData.maxValue = input.maxValue;
    if (input.thresholds !== undefined) updateData.thresholds = input.thresholds;

    const updated = await this.gradingSchemeRepo.update(id, tenantId, updateData);
    if (!updated) {
      throw new NotFoundError(`Grading scheme with id '${id}' not found`);
    }

    return updated;
  }

  /**
   * Get a grading scheme by ID.
   *
   * @throws NotFoundError if not found
   */
  async getGradingScheme(tenantId: string, id: string): Promise<GradingSchemeEntity> {
    const scheme = await this.gradingSchemeRepo.findById(id, tenantId);
    if (!scheme) {
      throw new NotFoundError(`Grading scheme with id '${id}' not found`);
    }
    return scheme;
  }

  /**
   * Delete a grading scheme.
   *
   * @throws NotFoundError if not found
   */
  async deleteGradingScheme(tenantId: string, id: string): Promise<void> {
    const deleted = await this.gradingSchemeRepo.delete(id, tenantId);
    if (!deleted) {
      throw new NotFoundError(`Grading scheme with id '${id}' not found`);
    }
  }

  /**
   * List grading schemes with pagination and filtering.
   */
  async listGradingSchemes(
    tenantId: string,
    filter: GradingSchemeFilter,
    pagination: PaginationOptions,
  ): Promise<PaginatedResult<GradingSchemeEntity>> {
    return this.gradingSchemeRepo.list(tenantId, filter, pagination);
  }

  // ─── Assessment Item Operations ──────────────────────────────────────────

  /**
   * Define assessment items for a subject in an academic period.
   *
   * Validates:
   * - Grading scheme exists
   * - Number of items does not exceed 50
   * - All item weights sum to exactly 100%
   * - Each item's minScore < maxScore
   * - Each item's score range is within grading scheme bounds
   * - All referenced outcome IDs exist
   *
   * Requirement 8.2: Up to 50 items, weights sum to 100%
   * Requirement 8.3: Reject if weights don't sum to 100%
   * Requirement 8.6: Outcome-based mapping
   *
   * @throws NotFoundError if grading scheme not found
   * @throws BusinessRuleError if weight sum != 100 or item count > 50
   * @throws ValidationError if outcome IDs are invalid
   */
  async defineAssessmentItems(
    tenantId: string,
    input: DefineAssessmentItemsInput,
  ): Promise<AssessmentItemEntity[]> {
    // Validate grading scheme exists
    const gradingScheme = await this.gradingSchemeRepo.findById(input.gradingSchemeId, tenantId);
    if (!gradingScheme) {
      throw new NotFoundError(
        `Grading scheme with id '${input.gradingSchemeId}' not found`,
      );
    }

    // Validate item count (max 50)
    if (input.items.length > MAX_ITEMS_PER_SUBJECT_PERIOD) {
      throw new BusinessRuleError(
        `Cannot define more than ${MAX_ITEMS_PER_SUBJECT_PERIOD} assessment items per subject per academic period. Received: ${input.items.length}`,
      );
    }

    // Validate weight sum equals 100%
    const totalWeight = input.items.reduce((sum, item) => sum + item.weight, 0);
    const roundedTotal = Math.round(totalWeight * 100) / 100;
    if (roundedTotal !== REQUIRED_WEIGHT_TOTAL) {
      const difference = REQUIRED_WEIGHT_TOTAL - roundedTotal;
      throw new BusinessRuleError(
        `Assessment item weights must sum to exactly 100%. Current total: ${roundedTotal}%, difference: ${difference > 0 ? '+' : ''}${difference}%`,
      );
    }

    // Validate each item's score range
    const errors: FieldError[] = [];
    for (let i = 0; i < input.items.length; i++) {
      const item = input.items[i]!;
      if (item.minScore >= item.maxScore) {
        errors.push({
          field: `items[${i}].minScore`,
          rule: 'range',
          message: `Item '${item.name}': minScore (${item.minScore}) must be less than maxScore (${item.maxScore})`,
        });
      }
    }

    if (errors.length > 0) {
      throw new ValidationError('Assessment item validation failed', errors);
    }

    // Validate outcome IDs if provided
    const allOutcomeIds = input.items
      .flatMap((item) => item.outcomeIds ?? [])
      .filter((id, index, arr) => arr.indexOf(id) === index); // deduplicate

    if (allOutcomeIds.length > 0) {
      const foundOutcomes = await this.outcomeRepo.findByIds(allOutcomeIds, tenantId);
      const foundIds = new Set(foundOutcomes.map((o) => o.id));
      const missingIds = allOutcomeIds.filter((id) => !foundIds.has(id));

      if (missingIds.length > 0) {
        throw new ValidationError('Invalid outcome references', missingIds.map((id) => ({
          field: 'items.outcomeIds',
          rule: 'exists',
          message: `Outcome with id '${id}' not found`,
        })));
      }
    }

    // Create assessment item entities
    const itemEntities: Omit<AssessmentItemEntity, 'createdAt' | 'updatedAt'>[] = input.items.map(
      (item) => ({
        id: uuidv4(),
        tenantId,
        subjectId: input.subjectId,
        academicPeriodId: input.academicPeriodId,
        gradingSchemeId: input.gradingSchemeId,
        name: item.name,
        weight: item.weight,
        maxScore: item.maxScore,
        minScore: item.minScore,
        outcomeIds: item.outcomeIds ?? [],
      }),
    );

    // Replace existing items for this subject+period
    return this.assessmentItemRepo.replaceItemsForSubjectPeriod(
      tenantId,
      input.subjectId,
      input.academicPeriodId,
      itemEntities,
    );
  }

  /**
   * Get assessment items for a subject in an academic period.
   */
  async getAssessmentItems(
    tenantId: string,
    subjectId: string,
    academicPeriodId: string,
  ): Promise<AssessmentItemEntity[]> {
    return this.assessmentItemRepo.findBySubjectAndPeriod(tenantId, subjectId, academicPeriodId);
  }

  // ─── Outcome Operations ──────────────────────────────────────────────────

  /**
   * Create a curriculum outcome.
   *
   * Requirement 8.6: Outcome-based assessment mapping.
   */
  async createOutcome(tenantId: string, input: CreateOutcomeInput): Promise<OutcomeEntity> {
    const entity: Omit<OutcomeEntity, 'createdAt' | 'updatedAt'> = {
      id: uuidv4(),
      tenantId,
      name: input.name,
      code: input.code,
      description: input.description ?? null,
      subjectId: input.subjectId,
    };

    return this.outcomeRepo.create(entity);
  }

  /**
   * Get outcomes for a subject.
   */
  async getOutcomesBySubject(tenantId: string, subjectId: string): Promise<OutcomeEntity[]> {
    return this.outcomeRepo.findBySubject(tenantId, subjectId);
  }

  /**
   * Delete an outcome.
   *
   * @throws NotFoundError if not found
   */
  async deleteOutcome(tenantId: string, id: string): Promise<void> {
    const deleted = await this.outcomeRepo.delete(id, tenantId);
    if (!deleted) {
      throw new NotFoundError(`Outcome with id '${id}' not found`);
    }
  }

  // ─── Private Helpers ─────────────────────────────────────────────────────

  /**
   * Validate grading scheme thresholds.
   *
   * Ensures:
   * - All threshold scores are within [minValue, maxValue]
   * - Each threshold's minScore <= maxScore
   * - No overlapping thresholds
   */
  private validateThresholds(
    thresholds: GradeThreshold[],
    minValue: number,
    maxValue: number,
  ): void {
    for (const threshold of thresholds) {
      if (threshold.minScore > threshold.maxScore) {
        throw new BusinessRuleError(
          `Grade '${threshold.grade}': minScore (${threshold.minScore}) must be less than or equal to maxScore (${threshold.maxScore})`,
        );
      }

      if (threshold.minScore < minValue || threshold.maxScore > maxValue) {
        throw new BusinessRuleError(
          `Grade '${threshold.grade}': score range [${threshold.minScore}, ${threshold.maxScore}] must be within scheme range [${minValue}, ${maxValue}]`,
        );
      }
    }

    // Check for overlapping thresholds
    const sorted = [...thresholds].sort((a, b) => a.minScore - b.minScore);
    for (let i = 1; i < sorted.length; i++) {
      const current = sorted[i]!;
      const previous = sorted[i - 1]!;
      if (current.minScore <= previous.maxScore) {
        throw new BusinessRuleError(
          `Grade thresholds overlap: '${previous.grade}' [${previous.minScore}-${previous.maxScore}] and '${current.grade}' [${current.minScore}-${current.maxScore}]`,
        );
      }
    }
  }
}
