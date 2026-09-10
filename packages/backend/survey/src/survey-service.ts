/**
 * Survey Service
 *
 * Business logic for survey operations including:
 * - Survey CRUD with question type validation
 * - Distribution to institutions based on filters
 * - Submission validation (required fields, data types)
 * - Completion tracking with reminder support
 * - Response aggregation with cross-tabulation
 *
 * Requirements: 23.1, 23.2, 23.3, 23.4, 23.5
 */
import { ConflictError, NotFoundError, BusinessRuleError, ValidationError } from '@proctira/common';
import type { PaginationOptions, PaginatedResult, FieldError } from '@proctira/common';
import { v4 as uuidv4 } from 'uuid';

import type {
  SurveyEntity,
  QuestionEntity,
  SurveyFilter,
  SurveyRepository,
  DistributionRecordEntity,
  DistributionRepository,
  SubmissionEntity,
  SubmissionRepository,
  InstitutionLookup,
} from './survey-repository.js';
import type {
  CreateSurveyInput,
  UpdateSurveyInput,
  DistributeSurveyInput,
  SubmitSurveyInput,
  QuestionInput,
  CompletionStatus,
} from './schemas.js';

/**
 * Notification publisher interface for sending reminders.
 */
export interface NotificationPublisher {
  sendReminder(tenantId: string, surveyId: string, institutionIds: string[]): Promise<void>;
}

/**
 * Service handling survey business logic.
 */
export class SurveyService {
  constructor(
    private readonly surveyRepo: SurveyRepository,
    private readonly distributionRepo: DistributionRepository,
    private readonly submissionRepo: SubmissionRepository,
    private readonly institutionLookup: InstitutionLookup,
    private readonly notificationPublisher: NotificationPublisher | null = null,
  ) {}

  // ─── Survey CRUD Operations ──────────────────────────────────────────────

  /**
   * Create a new survey.
   * Requirement 23.1: Creating surveys with configurable question types.
   *
   * @throws ConflictError if name already exists within tenant
   * @throws BusinessRuleError if questions are invalid
   */
  async createSurvey(tenantId: string, input: CreateSurveyInput): Promise<SurveyEntity> {
    // Check name uniqueness within tenant
    const existing = await this.surveyRepo.findByName(input.name, tenantId);
    if (existing) {
      throw new ConflictError(`Survey with name '${input.name}' already exists`);
    }

    // Validate questions
    this.validateQuestions(input.questions);

    // Build question entities with IDs
    const questions: QuestionEntity[] = input.questions.map((q) => ({
      id: uuidv4(),
      label: q.label,
      type: q.type,
      required: q.required ?? false,
      order: q.order,
      options: q.options,
      columns: q.columns,
      repeaterFields: q.repeaterFields?.map((f) => ({
        label: f.label,
        type: f.type,
        required: f.required ?? false,
        options: f.options,
      })),
      validation: q.validation,
    }));

    const entity: Omit<SurveyEntity, 'createdAt' | 'updatedAt'> = {
      id: uuidv4(),
      tenantId,
      name: input.name,
      description: input.description ?? null,
      status: 'draft',
      academicPeriodId: input.academicPeriodId ?? null,
      startDate: input.startDate ?? null,
      endDate: input.endDate ?? null,
      questions,
    };

    return this.surveyRepo.create(entity);
  }

  /**
   * Update an existing survey.
   *
   * @throws NotFoundError if survey not found
   * @throws ConflictError if new name conflicts
   * @throws BusinessRuleError if survey is closed or questions are invalid
   */
  async updateSurvey(
    tenantId: string,
    id: string,
    input: UpdateSurveyInput,
  ): Promise<SurveyEntity> {
    const existing = await this.surveyRepo.findById(id, tenantId);
    if (!existing) {
      throw new NotFoundError(`Survey with id '${id}' not found`);
    }

    if (existing.status === 'closed') {
      throw new BusinessRuleError('Cannot update a closed survey');
    }

    // If name is changing, check uniqueness
    if (input.name && input.name !== existing.name) {
      const byName = await this.surveyRepo.findByName(input.name, tenantId);
      if (byName) {
        throw new ConflictError(`Survey with name '${input.name}' already exists`);
      }
    }

    // Validate questions if provided
    if (input.questions) {
      this.validateQuestions(input.questions);
    }

    const updateData: Partial<Omit<SurveyEntity, 'id' | 'tenantId' | 'createdAt' | 'updatedAt'>> =
      {};
    if (input.name !== undefined) updateData.name = input.name;
    if (input.description !== undefined) updateData.description = input.description;
    if (input.academicPeriodId !== undefined) updateData.academicPeriodId = input.academicPeriodId;
    if (input.startDate !== undefined) updateData.startDate = input.startDate;
    if (input.endDate !== undefined) updateData.endDate = input.endDate;
    if (input.status !== undefined) updateData.status = input.status;
    if (input.questions !== undefined) {
      updateData.questions = input.questions.map((q) => ({
        id: uuidv4(),
        label: q.label,
        type: q.type,
        required: q.required ?? false,
        order: q.order,
        options: q.options,
        columns: q.columns,
        repeaterFields: q.repeaterFields?.map((f) => ({
          label: f.label,
          type: f.type,
          required: f.required ?? false,
          options: f.options,
        })),
        validation: q.validation,
      }));
    }

    const updated = await this.surveyRepo.update(id, tenantId, updateData);
    if (!updated) {
      throw new NotFoundError(`Survey with id '${id}' not found`);
    }

    return updated;
  }

  /**
   * Get a survey by ID.
   * @throws NotFoundError if not found
   */
  async getSurvey(tenantId: string, id: string): Promise<SurveyEntity> {
    const survey = await this.surveyRepo.findById(id, tenantId);
    if (!survey) {
      throw new NotFoundError(`Survey with id '${id}' not found`);
    }
    return survey;
  }

  /**
   * Delete a survey.
   * @throws NotFoundError if not found
   */
  async deleteSurvey(tenantId: string, id: string): Promise<void> {
    const deleted = await this.surveyRepo.delete(id, tenantId);
    if (!deleted) {
      throw new NotFoundError(`Survey with id '${id}' not found`);
    }
  }

  /**
   * List surveys with pagination and filtering.
   */
  async listSurveys(
    tenantId: string,
    filter: SurveyFilter,
    pagination: PaginationOptions,
  ): Promise<PaginatedResult<SurveyEntity>> {
    return this.surveyRepo.list(tenantId, filter, pagination);
  }

  // ─── Distribution Operations ─────────────────────────────────────────────

  /**
   * Distribute a survey to institutions based on filters.
   * Requirement 23.2: Distribute based on area, type, classification.
   *
   * @throws NotFoundError if survey not found
   * @throws BusinessRuleError if survey is not published or no institutions match
   */
  async distributeSurvey(
    tenantId: string,
    input: DistributeSurveyInput,
  ): Promise<DistributionRecordEntity[]> {
    const survey = await this.surveyRepo.findById(input.surveyId, tenantId);
    if (!survey) {
      throw new NotFoundError(`Survey with id '${input.surveyId}' not found`);
    }

    if (survey.status !== 'published') {
      throw new BusinessRuleError('Survey must be published before distribution');
    }

    // Find institutions matching filters
    const institutionIds = await this.institutionLookup.findByFilters(tenantId, input.filters);

    if (institutionIds.length === 0) {
      throw new BusinessRuleError('No institutions match the specified filters');
    }

    // Create distribution records
    const records: Omit<DistributionRecordEntity, 'createdAt' | 'updatedAt'>[] = institutionIds.map(
      (institutionId) => ({
        id: uuidv4(),
        tenantId,
        surveyId: input.surveyId,
        institutionId,
        status: 'pending' as CompletionStatus,
        dueDate: input.dueDate ?? null,
        submittedAt: null,
        remindersSent: 0,
        reminderDays: input.reminderDays ?? [],
      }),
    );

    return this.distributionRepo.createMany(records);
  }

  // ─── Submission Operations ───────────────────────────────────────────────

  /**
   * Submit survey responses for an institution.
   * Requirement 23.3: Validate required fields and data type constraints.
   *
   * @throws NotFoundError if survey not found or institution not distributed
   * @throws ValidationError if required fields missing or data types invalid
   * @throws BusinessRuleError if already submitted
   */
  async submitSurvey(tenantId: string, input: SubmitSurveyInput): Promise<SubmissionEntity> {
    const survey = await this.surveyRepo.findById(input.surveyId, tenantId);
    if (!survey) {
      throw new NotFoundError(`Survey with id '${input.surveyId}' not found`);
    }

    // Check distribution record exists
    const distribution = await this.distributionRepo.findBySurveyAndInstitution(
      tenantId,
      input.surveyId,
      input.institutionId,
    );
    if (!distribution) {
      throw new NotFoundError(`Survey not distributed to institution '${input.institutionId}'`);
    }

    if (distribution.status === 'completed') {
      throw new BusinessRuleError('Survey has already been submitted for this institution');
    }

    // Validate answers against questions
    const errors = this.validateSubmission(survey.questions, input.answers);
    if (errors.length > 0) {
      throw new ValidationError('Survey submission validation failed', errors);
    }

    // Create submission
    const submission = await this.submissionRepo.create({
      id: uuidv4(),
      tenantId,
      surveyId: input.surveyId,
      institutionId: input.institutionId,
      answers: input.answers,
      submittedAt: new Date(),
    });

    // Update distribution status to completed
    await this.distributionRepo.update(distribution.id, tenantId, {
      status: 'completed',
      submittedAt: new Date().toISOString(),
    });

    return submission;
  }

  // ─── Reminder Operations ─────────────────────────────────────────────────

  /**
   * Send reminders for incomplete survey submissions.
   * Requirement 23.4: Track completion with reminders.
   *
   * @throws NotFoundError if survey not found
   */
  async sendReminders(
    tenantId: string,
    surveyId: string,
    institutionIds?: string[],
  ): Promise<{ remindersSent: number }> {
    const survey = await this.surveyRepo.findById(surveyId, tenantId);
    if (!survey) {
      throw new NotFoundError(`Survey with id '${surveyId}' not found`);
    }

    let incompleteRecords = await this.distributionRepo.findIncompleteBySurvey(tenantId, surveyId);

    // Filter to specific institutions if provided
    if (institutionIds && institutionIds.length > 0) {
      const idSet = new Set(institutionIds);
      incompleteRecords = incompleteRecords.filter((r) => idSet.has(r.institutionId));
    }

    if (incompleteRecords.length === 0) {
      return { remindersSent: 0 };
    }

    // Send notifications if publisher is available
    const targetInstitutionIds = incompleteRecords.map((r) => r.institutionId);
    if (this.notificationPublisher) {
      await this.notificationPublisher.sendReminder(tenantId, surveyId, targetInstitutionIds);
    }

    // Update reminder counts
    for (const record of incompleteRecords) {
      await this.distributionRepo.update(record.id, tenantId, {
        remindersSent: record.remindersSent + 1,
      });
    }

    return { remindersSent: incompleteRecords.length };
  }

  /**
   * Get completion status for a survey.
   * Requirement 23.4: Track completion status per institution.
   */
  async getCompletionStatus(
    tenantId: string,
    surveyId: string,
  ): Promise<{
    total: number;
    pending: number;
    inProgress: number;
    completed: number;
    completionRate: number;
  }> {
    const counts = await this.distributionRepo.countByStatus(tenantId, surveyId);
    const total = counts.pending + counts.in_progress + counts.completed;
    const completionRate = total > 0 ? Math.round((counts.completed / total) * 10000) / 100 : 0;

    return {
      total,
      pending: counts.pending,
      inProgress: counts.in_progress,
      completed: counts.completed,
      completionRate,
    };
  }

  // ─── Aggregation Operations ──────────────────────────────────────────────

  /**
   * Aggregate survey responses into summary reports.
   * Requirement 23.5: Aggregate with cross-tabulation by area and type.
   *
   * @throws NotFoundError if survey not found
   */
  async aggregateResponses(
    tenantId: string,
    surveyId: string,
    groupBy?: 'area' | 'institution_type',
  ): Promise<{
    surveyId: string;
    totalDistributed: number;
    totalCompleted: number;
    completionRate: number;
    questionSummaries: QuestionSummary[];
    crossTabulation?: CrossTabulationEntry[];
  }> {
    const survey = await this.surveyRepo.findById(surveyId, tenantId);
    if (!survey) {
      throw new NotFoundError(`Survey with id '${surveyId}' not found`);
    }

    const submissions = await this.submissionRepo.findBySurvey(tenantId, surveyId);
    const distributions = await this.distributionRepo.findBySurvey(tenantId, surveyId);

    const totalDistributed = distributions.length;
    const totalCompleted = distributions.filter((d) => d.status === 'completed').length;
    const completionRate =
      totalDistributed > 0 ? Math.round((totalCompleted / totalDistributed) * 10000) / 100 : 0;

    // Aggregate per question
    const questionSummaries = survey.questions.map((question) => {
      const answers = submissions
        .flatMap((s) => s.answers)
        .filter((a) => a.questionId === question.id);

      return {
        questionId: question.id,
        questionLabel: question.label,
        questionType: question.type,
        summary: this.aggregateQuestionAnswers(question, answers),
      };
    });

    // Cross-tabulation if requested
    let crossTabulation: CrossTabulationEntry[] | undefined;
    if (groupBy) {
      const institutionIds = distributions.map((d) => d.institutionId);
      const metadata = await this.institutionLookup.getMetadata(tenantId, institutionIds);

      const groups = new Map<string, { label: string; distributed: number; completed: number }>();

      for (const dist of distributions) {
        const meta = metadata.find((m) => m.id === dist.institutionId);
        if (!meta) continue;

        const key = groupBy === 'area' ? meta.areaId : meta.typeId;
        const label = groupBy === 'area' ? meta.areaName : meta.typeName;

        if (!groups.has(key)) {
          groups.set(key, { label, distributed: 0, completed: 0 });
        }
        const group = groups.get(key)!;
        group.distributed++;
        if (dist.status === 'completed') {
          group.completed++;
        }
      }

      crossTabulation = Array.from(groups.entries()).map(([key, group]) => ({
        groupKey: key,
        groupLabel: group.label,
        totalDistributed: group.distributed,
        totalCompleted: group.completed,
        completionRate:
          group.distributed > 0
            ? Math.round((group.completed / group.distributed) * 10000) / 100
            : 0,
      }));
    }

    return {
      surveyId,
      totalDistributed,
      totalCompleted,
      completionRate,
      questionSummaries,
      crossTabulation,
    };
  }

  // ─── Private Helpers ─────────────────────────────────────────────────────

  /**
   * Validate question definitions.
   * Ensures dropdown/checkbox have options, table has columns, repeater has fields.
   */
  private validateQuestions(questions: QuestionInput[]): void {
    const errors: FieldError[] = [];

    for (let i = 0; i < questions.length; i++) {
      const q = questions[i]!;

      if (
        (q.type === 'dropdown' || q.type === 'checkbox') &&
        (!q.options || q.options.length === 0)
      ) {
        errors.push({
          field: `questions[${i}].options`,
          rule: 'required',
          message: `Question '${q.label}': ${q.type} questions must have at least one option`,
        });
      }

      if (q.type === 'table' && (!q.columns || q.columns.length === 0)) {
        errors.push({
          field: `questions[${i}].columns`,
          rule: 'required',
          message: `Question '${q.label}': table questions must have at least one column`,
        });
      }

      if (q.type === 'repeater' && (!q.repeaterFields || q.repeaterFields.length === 0)) {
        errors.push({
          field: `questions[${i}].repeaterFields`,
          rule: 'required',
          message: `Question '${q.label}': repeater questions must have at least one field`,
        });
      }
    }

    if (errors.length > 0) {
      throw new ValidationError('Question validation failed', errors);
    }
  }

  /**
   * Validate survey submission answers against question definitions.
   * Requirement 23.3: Validate required fields and data type constraints.
   */
  private validateSubmission(
    questions: QuestionEntity[],
    answers: Array<{ questionId: string; value: unknown }>,
  ): FieldError[] {
    const errors: FieldError[] = [];
    const answerMap = new Map(answers.map((a) => [a.questionId, a.value]));

    for (const question of questions) {
      const value = answerMap.get(question.id);

      // Check required fields
      if (question.required && (value === undefined || value === null || value === '')) {
        errors.push({
          field: `answers.${question.id}`,
          rule: 'required',
          message: `Question '${question.label}' is required`,
        });
        continue;
      }

      // Skip validation if no value provided and not required
      if (value === undefined || value === null || value === '') {
        continue;
      }

      // Validate data type constraints
      switch (question.type) {
        case 'text':
          if (typeof value !== 'string') {
            errors.push({
              field: `answers.${question.id}`,
              rule: 'type',
              message: `Question '${question.label}' expects a text value`,
            });
          } else if (question.validation) {
            if (question.validation.minLength && value.length < question.validation.minLength) {
              errors.push({
                field: `answers.${question.id}`,
                rule: 'minLength',
                message: `Question '${question.label}' must be at least ${question.validation.minLength} characters`,
              });
            }
            if (question.validation.maxLength && value.length > question.validation.maxLength) {
              errors.push({
                field: `answers.${question.id}`,
                rule: 'maxLength',
                message: `Question '${question.label}' must be at most ${question.validation.maxLength} characters`,
              });
            }
          }
          break;

        case 'number':
          if (typeof value !== 'number' || isNaN(value)) {
            errors.push({
              field: `answers.${question.id}`,
              rule: 'type',
              message: `Question '${question.label}' expects a numeric value`,
            });
          } else if (question.validation) {
            if (question.validation.min !== undefined && value < question.validation.min) {
              errors.push({
                field: `answers.${question.id}`,
                rule: 'minimum',
                message: `Question '${question.label}' must be at least ${question.validation.min}`,
              });
            }
            if (question.validation.max !== undefined && value > question.validation.max) {
              errors.push({
                field: `answers.${question.id}`,
                rule: 'maximum',
                message: `Question '${question.label}' must be at most ${question.validation.max}`,
              });
            }
          }
          break;

        case 'date':
          if (typeof value !== 'string' || isNaN(Date.parse(value))) {
            errors.push({
              field: `answers.${question.id}`,
              rule: 'type',
              message: `Question '${question.label}' expects a valid date string`,
            });
          }
          break;

        case 'dropdown':
          if (typeof value !== 'string') {
            errors.push({
              field: `answers.${question.id}`,
              rule: 'type',
              message: `Question '${question.label}' expects a string value`,
            });
          } else if (question.options) {
            const validValues = question.options.map((o) => o.value);
            if (!validValues.includes(value)) {
              errors.push({
                field: `answers.${question.id}`,
                rule: 'enum',
                message: `Question '${question.label}' value must be one of: ${validValues.join(', ')}`,
              });
            }
          }
          break;

        case 'checkbox':
          if (!Array.isArray(value)) {
            errors.push({
              field: `answers.${question.id}`,
              rule: 'type',
              message: `Question '${question.label}' expects an array of selected values`,
            });
          } else if (question.options) {
            const validValues = question.options.map((o) => o.value);
            for (const v of value) {
              if (typeof v !== 'string' || !validValues.includes(v)) {
                errors.push({
                  field: `answers.${question.id}`,
                  rule: 'enum',
                  message: `Question '${question.label}' contains invalid option: ${String(v)}`,
                });
                break;
              }
            }
          }
          break;

        case 'table':
          if (!Array.isArray(value)) {
            errors.push({
              field: `answers.${question.id}`,
              rule: 'type',
              message: `Question '${question.label}' expects an array of row objects`,
            });
          }
          break;

        case 'repeater':
          if (!Array.isArray(value)) {
            errors.push({
              field: `answers.${question.id}`,
              rule: 'type',
              message: `Question '${question.label}' expects an array of repeater entries`,
            });
          }
          break;
      }
    }

    return errors;
  }

  /**
   * Aggregate answers for a single question based on its type.
   */
  private aggregateQuestionAnswers(
    question: QuestionEntity,
    answers: Array<{ questionId: string; value: unknown }>,
  ): unknown {
    const values = answers.map((a) => a.value).filter((v) => v !== null && v !== undefined);

    switch (question.type) {
      case 'text':
        return {
          totalResponses: values.length,
          sampleResponses: values.slice(0, 5),
        };

      case 'number': {
        const nums = values.filter((v): v is number => typeof v === 'number');
        if (nums.length === 0) return { totalResponses: 0, average: 0, min: 0, max: 0 };
        const sum = nums.reduce((a, b) => a + b, 0);
        return {
          totalResponses: nums.length,
          average: Math.round((sum / nums.length) * 100) / 100,
          min: Math.min(...nums),
          max: Math.max(...nums),
          sum,
        };
      }

      case 'date':
        return {
          totalResponses: values.length,
          sampleResponses: values.slice(0, 5),
        };

      case 'dropdown': {
        const counts: Record<string, number> = {};
        for (const v of values) {
          if (typeof v === 'string') {
            counts[v] = (counts[v] ?? 0) + 1;
          }
        }
        return { totalResponses: values.length, distribution: counts };
      }

      case 'checkbox': {
        const counts: Record<string, number> = {};
        for (const v of values) {
          if (Array.isArray(v)) {
            for (const item of v) {
              if (typeof item === 'string') {
                counts[item] = (counts[item] ?? 0) + 1;
              }
            }
          }
        }
        return { totalResponses: values.length, distribution: counts };
      }

      case 'table':
        return { totalResponses: values.length, totalRows: values.flat().length };

      case 'repeater':
        return { totalResponses: values.length, totalEntries: values.flat().length };

      default:
        return { totalResponses: values.length };
    }
  }
}

// ─── Types ───────────────────────────────────────────────────────────────────

export interface QuestionSummary {
  questionId: string;
  questionLabel: string;
  questionType: string;
  summary: unknown;
}

export interface CrossTabulationEntry {
  groupKey: string;
  groupLabel: string;
  totalDistributed: number;
  totalCompleted: number;
  completionRate: number;
}
