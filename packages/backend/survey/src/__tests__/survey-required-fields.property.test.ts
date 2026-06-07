/**
 * Property-Based Test: Survey Required Field Validation
 *
 * Invariant: Required survey fields are always validated before submission
 * is accepted. Any submission missing a required field must be rejected
 * with a ValidationError.
 */
import { describe, it, expect, beforeEach } from 'vitest';
import * as fc from 'fast-check';
import { v4 as uuidv4 } from 'uuid';

import { SurveyService } from '../survey-service.js';
import type {
  SurveyRepository,
  DistributionRepository,
  SubmissionRepository,
  InstitutionLookup,
  SurveyEntity,
  QuestionEntity,
  DistributionRecordEntity,
  SubmissionEntity,
} from '../survey-repository.js';
import type { PaginationOptions, PaginatedResult } from '@proctira/common';

// Minimal in-memory implementations for testing
class MockSurveyRepo implements SurveyRepository {
  private surveys = new Map<string, SurveyEntity>();

  async create(data: Omit<SurveyEntity, 'createdAt' | 'updatedAt'>): Promise<SurveyEntity> {
    const entity = { ...data, createdAt: new Date(), updatedAt: new Date() } as SurveyEntity;
    this.surveys.set(entity.id, entity);
    return entity;
  }

  async findById(id: string, tenantId: string): Promise<SurveyEntity | null> {
    const s = this.surveys.get(id);
    return s && s.tenantId === tenantId ? s : null;
  }

  async findByName(name: string, tenantId: string): Promise<SurveyEntity | null> {
    for (const s of this.surveys.values()) {
      if (s.name === name && s.tenantId === tenantId) return s;
    }
    return null;
  }

  async update(id: string, tenantId: string, data: Partial<SurveyEntity>): Promise<SurveyEntity | null> {
    const existing = this.surveys.get(id);
    if (!existing || existing.tenantId !== tenantId) return null;
    const updated = { ...existing, ...data, updatedAt: new Date() };
    this.surveys.set(id, updated);
    return updated;
  }

  async delete(id: string, tenantId: string): Promise<boolean> {
    const existing = this.surveys.get(id);
    if (!existing || existing.tenantId !== tenantId) return false;
    this.surveys.delete(id);
    return true;
  }

  async list(tenantId: string, filter: any, pagination: PaginationOptions): Promise<PaginatedResult<SurveyEntity>> {
    const items = Array.from(this.surveys.values()).filter(s => s.tenantId === tenantId);
    return { data: items, meta: { page: 1, pageSize: 20, totalItems: items.length, totalPages: 1 } };
  }
}

class MockDistributionRepo implements DistributionRepository {
  private records = new Map<string, DistributionRecordEntity>();

  setSurveyDistribution(record: DistributionRecordEntity) {
    this.records.set(`${record.surveyId}:${record.institutionId}`, record);
  }

  async createMany(data: any[]): Promise<DistributionRecordEntity[]> {
    return data.map(d => ({ ...d, createdAt: new Date(), updatedAt: new Date() }));
  }

  async findBySurveyAndInstitution(tenantId: string, surveyId: string, institutionId: string): Promise<DistributionRecordEntity | null> {
    return this.records.get(`${surveyId}:${institutionId}`) ?? null;
  }

  async findIncompleteBySurvey(tenantId: string, surveyId: string): Promise<DistributionRecordEntity[]> {
    return [];
  }

  async findBySurvey(tenantId: string, surveyId: string): Promise<DistributionRecordEntity[]> {
    return [];
  }

  async update(id: string, tenantId: string, data: any): Promise<DistributionRecordEntity | null> {
    return null;
  }

  async countByStatus(tenantId: string, surveyId: string): Promise<{ pending: number; in_progress: number; completed: number }> {
    return { pending: 0, in_progress: 0, completed: 0 };
  }
}

class MockSubmissionRepo implements SubmissionRepository {
  async create(data: any): Promise<SubmissionEntity> {
    return { ...data, createdAt: new Date(), updatedAt: new Date() };
  }

  async findBySurvey(tenantId: string, surveyId: string): Promise<SubmissionEntity[]> {
    return [];
  }
}

class MockInstitutionLookup implements InstitutionLookup {
  async findByFilters(tenantId: string, filters: any): Promise<string[]> {
    return [];
  }

  async getMetadata(tenantId: string, institutionIds: string[]): Promise<any[]> {
    return [];
  }
}

describe('Survey Service - Required Fields Validation (Property)', () => {
  let surveyRepo: MockSurveyRepo;
  let distributionRepo: MockDistributionRepo;
  let submissionRepo: MockSubmissionRepo;
  let service: SurveyService;
  const tenantId = uuidv4();

  beforeEach(() => {
    surveyRepo = new MockSurveyRepo();
    distributionRepo = new MockDistributionRepo();
    submissionRepo = new MockSubmissionRepo();
    service = new SurveyService(
      surveyRepo,
      distributionRepo,
      submissionRepo,
      new MockInstitutionLookup(),
    );
  });

  it('should reject submissions that omit any required field', async () => {
    await fc.assert(
      fc.asyncProperty(
        // Generate 1-5 required question labels
        fc.array(
          fc.string({ minLength: 1, maxLength: 30 }).filter(s => s.trim().length > 0),
          { minLength: 1, maxLength: 5 },
        ),
        // Generate which required question index to omit (at least one)
        fc.nat(),
        async (questionLabels, omitSeed) => {
          const surveyId = uuidv4();
          const institutionId = uuidv4();

          // Build questions — all required
          const questions: QuestionEntity[] = questionLabels.map((label, i) => ({
            id: uuidv4(),
            label: `${label}_${i}`,
            type: 'text' as const,
            required: true,
            order: i + 1,
            options: undefined,
            columns: undefined,
            repeaterFields: undefined,
            validation: undefined,
          }));

          // Create a published survey with required questions
          const survey: SurveyEntity = {
            id: surveyId,
            tenantId,
            name: `Survey-${uuidv4().slice(0, 8)}`,
            description: null,
            status: 'published',
            academicPeriodId: null,
            startDate: null,
            endDate: null,
            questions,
            createdAt: new Date(),
            updatedAt: new Date(),
          };

          // Directly insert into the mock repo
          await surveyRepo.create(survey);

          // Set up distribution record so submission is allowed
          distributionRepo.setSurveyDistribution({
            id: uuidv4(),
            tenantId,
            surveyId,
            institutionId,
            status: 'pending',
            dueDate: null,
            submittedAt: null,
            remindersSent: 0,
            reminderDays: [],
            createdAt: new Date(),
            updatedAt: new Date(),
          });

          // Build answers that omit at least one required question
          const omitIndex = omitSeed % questions.length;
          const answers = questions
            .filter((_, i) => i !== omitIndex)
            .map(q => ({ questionId: q.id, value: 'some answer' }));

          // Submission should be rejected due to missing required field
          await expect(
            service.submitSurvey(tenantId, {
              surveyId,
              institutionId,
              answers,
            }),
          ).rejects.toThrow('Survey submission validation failed');
        },
      ),
      { numRuns: 50 },
    );
  });
});
