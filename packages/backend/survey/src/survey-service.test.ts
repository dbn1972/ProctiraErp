/**
 * Unit tests for SurveyService
 *
 * Tests survey CRUD, distribution, submission validation,
 * completion tracking, reminders, and response aggregation.
 *
 * Requirements: 23.1, 23.2, 23.3, 23.4, 23.5
 */
import { describe, it, expect, beforeEach } from 'vitest';
import {
  ConflictError,
  NotFoundError,
  BusinessRuleError,
  ValidationError,
  ForbiddenError,
} from '@proctira/common';

import { SurveyService } from './survey-service.js';
import type { NotificationPublisher } from './survey-service.js';
import {
  InMemorySurveyRepository,
  InMemoryDistributionRepository,
  InMemorySubmissionRepository,
  InMemoryInstitutionLookup,
} from './in-memory-repository.js';

describe('SurveyService', () => {
  let service: SurveyService;
  let surveyRepo: InMemorySurveyRepository;
  let distributionRepo: InMemoryDistributionRepository;
  let submissionRepo: InMemorySubmissionRepository;
  let institutionLookup: InMemoryInstitutionLookup;
  let notificationPublisher: NotificationPublisher;

  const tenantId = 'tenant-001';

  beforeEach(() => {
    surveyRepo = new InMemorySurveyRepository();
    distributionRepo = new InMemoryDistributionRepository();
    submissionRepo = new InMemorySubmissionRepository();
    institutionLookup = new InMemoryInstitutionLookup();
    notificationPublisher = {
      sendReminder: async () => {},
    };
    service = new SurveyService(
      surveyRepo,
      distributionRepo,
      submissionRepo,
      institutionLookup,
      notificationPublisher,
    );
  });

  // ─── Survey CRUD Tests ───────────────────────────────────────────────────

  describe('createSurvey', () => {
    it('should create a survey with text questions', async () => {
      const input = {
        name: 'Annual School Survey',
        description: 'Yearly data collection',
        questions: [
          { label: 'School Name', type: 'text' as const, required: true, order: 0 },
          { label: 'Number of Students', type: 'number' as const, required: true, order: 1 },
        ],
      };

      const result = await service.createSurvey(tenantId, input);

      expect(result.id).toBeDefined();
      expect(result.tenantId).toBe(tenantId);
      expect(result.name).toBe('Annual School Survey');
      expect(result.status).toBe('draft');
      expect(result.questions).toHaveLength(2);
      expect(result.questions[0]!.type).toBe('text');
      expect(result.questions[0]!.required).toBe(true);
    });

    it('should create a survey with all question types', async () => {
      const input = {
        name: 'Comprehensive Survey',
        questions: [
          { label: 'Name', type: 'text' as const, order: 0 },
          { label: 'Count', type: 'number' as const, order: 1 },
          { label: 'Date', type: 'date' as const, order: 2 },
          {
            label: 'Category',
            type: 'dropdown' as const,
            order: 3,
            options: [
              { label: 'Option A', value: 'a' },
              { label: 'Option B', value: 'b' },
            ],
          },
          {
            label: 'Features',
            type: 'checkbox' as const,
            order: 4,
            options: [
              { label: 'Feature 1', value: 'f1' },
              { label: 'Feature 2', value: 'f2' },
            ],
          },
          {
            label: 'Staff Table',
            type: 'table' as const,
            order: 5,
            columns: [
              { name: 'Name', type: 'text' as const },
              { name: 'Age', type: 'number' as const },
            ],
          },
          {
            label: 'Facilities',
            type: 'repeater' as const,
            order: 6,
            repeaterFields: [
              { label: 'Facility Name', type: 'text' as const },
              { label: 'Capacity', type: 'number' as const },
            ],
          },
        ],
      };

      const result = await service.createSurvey(tenantId, input);
      expect(result.questions).toHaveLength(7);
    });

    it('should throw ConflictError for duplicate name', async () => {
      const input = {
        name: 'Duplicate Survey',
        questions: [{ label: 'Q1', type: 'text' as const, order: 0 }],
      };

      await service.createSurvey(tenantId, input);
      await expect(service.createSurvey(tenantId, input)).rejects.toThrow(ConflictError);
    });

    it('should throw ValidationError for dropdown without options', async () => {
      const input = {
        name: 'Bad Survey',
        questions: [{ label: 'Category', type: 'dropdown' as const, order: 0 }],
      };

      await expect(service.createSurvey(tenantId, input)).rejects.toThrow(ValidationError);
    });

    it('should throw ValidationError for table without columns', async () => {
      const input = {
        name: 'Bad Table Survey',
        questions: [{ label: 'Data', type: 'table' as const, order: 0 }],
      };

      await expect(service.createSurvey(tenantId, input)).rejects.toThrow(ValidationError);
    });

    it('should throw ValidationError for repeater without fields', async () => {
      const input = {
        name: 'Bad Repeater Survey',
        questions: [{ label: 'Items', type: 'repeater' as const, order: 0 }],
      };

      await expect(service.createSurvey(tenantId, input)).rejects.toThrow(ValidationError);
    });
  });

  describe('updateSurvey', () => {
    it('should update survey name', async () => {
      const survey = await service.createSurvey(tenantId, {
        name: 'Original',
        questions: [{ label: 'Q1', type: 'text' as const, order: 0 }],
      });

      const updated = await service.updateSurvey(tenantId, survey.id, {
        name: 'Updated Name',
      });

      expect(updated.name).toBe('Updated Name');
    });

    it('should throw BusinessRuleError when updating closed survey', async () => {
      const survey = await service.createSurvey(tenantId, {
        name: 'Closeable',
        questions: [{ label: 'Q1', type: 'text' as const, order: 0 }],
      });

      await service.updateSurvey(tenantId, survey.id, { status: 'closed' });

      await expect(service.updateSurvey(tenantId, survey.id, { name: 'New Name' })).rejects.toThrow(
        BusinessRuleError,
      );
    });

    it('should throw NotFoundError for non-existent survey', async () => {
      await expect(
        service.updateSurvey(tenantId, 'non-existent-id', { name: 'X' }),
      ).rejects.toThrow(NotFoundError);
    });
  });

  // ─── Distribution Tests ──────────────────────────────────────────────────

  describe('distributeSurvey', () => {
    it('should distribute survey to matching institutions', async () => {
      const survey = await service.createSurvey(tenantId, {
        name: 'Distribution Test',
        questions: [{ label: 'Q1', type: 'text' as const, order: 0 }],
      });
      await service.updateSurvey(tenantId, survey.id, { status: 'published' });

      institutionLookup.addInstitution({
        id: 'inst-001',
        tenantId,
        areaId: 'area-001',
        areaName: 'District A',
        typeId: 'type-001',
        typeName: 'Primary',
        classificationId: 'class-001',
        name: 'School 1',
      });
      institutionLookup.addInstitution({
        id: 'inst-002',
        tenantId,
        areaId: 'area-001',
        areaName: 'District A',
        typeId: 'type-002',
        typeName: 'Secondary',
        classificationId: 'class-001',
        name: 'School 2',
      });

      const records = await service.distributeSurvey(tenantId, {
        surveyId: survey.id,
        filters: { areaIds: ['area-001'] },
        dueDate: '2025-06-30',
        reminderDays: [7, 3, 1],
      });

      expect(records).toHaveLength(2);
      expect(records[0]!.status).toBe('pending');
      expect(records[0]!.dueDate).toBe('2025-06-30');
    });

    it('should throw BusinessRuleError for draft survey', async () => {
      const survey = await service.createSurvey(tenantId, {
        name: 'Draft Survey',
        questions: [{ label: 'Q1', type: 'text' as const, order: 0 }],
      });

      await expect(
        service.distributeSurvey(tenantId, {
          surveyId: survey.id,
          filters: {},
        }),
      ).rejects.toThrow(BusinessRuleError);
    });

    it('should throw BusinessRuleError when no institutions match', async () => {
      const survey = await service.createSurvey(tenantId, {
        name: 'No Match Survey',
        questions: [{ label: 'Q1', type: 'text' as const, order: 0 }],
      });
      await service.updateSurvey(tenantId, survey.id, { status: 'published' });

      await expect(
        service.distributeSurvey(tenantId, {
          surveyId: survey.id,
          filters: { areaIds: ['non-existent-area'] },
        }),
      ).rejects.toThrow(BusinessRuleError);
    });

    it('#555 review #12: concurrent distributes create one record per institution', async () => {
      const survey = await service.createSurvey(tenantId, {
        name: 'Concurrent Distribution',
        questions: [{ label: 'Q1', type: 'text' as const, order: 0 }],
      });
      await service.updateSurvey(tenantId, survey.id, { status: 'published' });
      for (const id of ['inst-101', 'inst-102']) {
        institutionLookup.addInstitution({
          id,
          tenantId,
          areaId: 'area-009',
          areaName: 'District Z',
          typeId: 'type-001',
          typeName: 'Primary',
          classificationId: 'class-001',
          name: id,
        });
      }
      const input = { surveyId: survey.id, filters: { areaIds: ['area-009'] } };
      const [a, b] = await Promise.all([
        service.distributeSurvey(tenantId, input),
        service.distributeSurvey(tenantId, input),
      ]);
      const stored = await distributionRepo.findBySurvey(tenantId, survey.id);
      expect(stored).toHaveLength(2);
      expect(new Set(stored.map((r) => r.institutionId))).toEqual(
        new Set(['inst-101', 'inst-102']),
      );
      // Both callers see the same stored rows.
      expect(a.map((r) => r.id).sort()).toEqual(stored.map((r) => r.id).sort());
      expect(b.map((r) => r.id).sort()).toEqual(stored.map((r) => r.id).sort());
    });
  });

  // ─── Submission Tests ────────────────────────────────────────────────────

  describe('submitSurvey', () => {
    async function setupDistributedSurvey() {
      const survey = await service.createSurvey(tenantId, {
        name: 'Submission Test',
        questions: [
          { label: 'School Name', type: 'text' as const, required: true, order: 0 },
          {
            label: 'Student Count',
            type: 'number' as const,
            required: true,
            order: 1,
            validation: { min: 0, max: 10000 },
          },
          {
            label: 'School Type',
            type: 'dropdown' as const,
            required: true,
            order: 2,
            options: [
              { label: 'Primary', value: 'primary' },
              { label: 'Secondary', value: 'secondary' },
            ],
          },
        ],
      });
      await service.updateSurvey(tenantId, survey.id, { status: 'published' });

      institutionLookup.addInstitution({
        id: 'inst-001',
        tenantId,
        areaId: 'area-001',
        areaName: 'District A',
        typeId: 'type-001',
        typeName: 'Primary',
        classificationId: 'class-001',
        name: 'School 1',
      });

      await service.distributeSurvey(tenantId, {
        surveyId: survey.id,
        filters: {},
      });

      return survey;
    }

    it('PRC-M387: rejects submission for an institution outside the caller scope', async () => {
      const survey = await setupDistributedSurvey();
      const questions = survey.questions;
      await expect(
        service.submitSurvey(
          tenantId,
          {
            surveyId: survey.id,
            institutionId: 'inst-001',
            answers: [
              { questionId: questions[0]!.id, value: 'Test School' },
              { questionId: questions[1]!.id, value: 500 },
              { questionId: questions[2]!.id, value: 'primary' },
            ],
          },
          { institutionIds: ['inst-other'] },
        ),
      ).rejects.toThrow(ForbiddenError);
      // Nothing recorded; the in-scope institution can still submit.
      const ok = await service.submitSurvey(
        tenantId,
        {
          surveyId: survey.id,
          institutionId: 'inst-001',
          answers: [
            { questionId: questions[0]!.id, value: 'Test School' },
            { questionId: questions[1]!.id, value: 500 },
            { questionId: questions[2]!.id, value: 'primary' },
          ],
        },
        { institutionIds: ['inst-001'] },
      );
      expect(ok.institutionId).toBe('inst-001');
    });

    it('should accept valid submission', async () => {
      const survey = await setupDistributedSurvey();
      const questions = survey.questions;

      const submission = await service.submitSurvey(tenantId, {
        surveyId: survey.id,
        institutionId: 'inst-001',
        answers: [
          { questionId: questions[0]!.id, value: 'Test School' },
          { questionId: questions[1]!.id, value: 500 },
          { questionId: questions[2]!.id, value: 'primary' },
        ],
      });

      expect(submission.id).toBeDefined();
      expect(submission.surveyId).toBe(survey.id);
      expect(submission.institutionId).toBe('inst-001');
    });

    it('should reject submission with missing required fields', async () => {
      const survey = await setupDistributedSurvey();
      const questions = survey.questions;

      await expect(
        service.submitSurvey(tenantId, {
          surveyId: survey.id,
          institutionId: 'inst-001',
          answers: [
            { questionId: questions[0]!.id, value: 'Test School' },
            // Missing required questions[1] and questions[2]
          ],
        }),
      ).rejects.toThrow(ValidationError);
    });

    it('should reject submission with wrong data type', async () => {
      const survey = await setupDistributedSurvey();
      const questions = survey.questions;

      await expect(
        service.submitSurvey(tenantId, {
          surveyId: survey.id,
          institutionId: 'inst-001',
          answers: [
            { questionId: questions[0]!.id, value: 'Test School' },
            { questionId: questions[1]!.id, value: 'not a number' },
            { questionId: questions[2]!.id, value: 'primary' },
          ],
        }),
      ).rejects.toThrow(ValidationError);
    });

    it('should reject submission with invalid dropdown value', async () => {
      const survey = await setupDistributedSurvey();
      const questions = survey.questions;

      await expect(
        service.submitSurvey(tenantId, {
          surveyId: survey.id,
          institutionId: 'inst-001',
          answers: [
            { questionId: questions[0]!.id, value: 'Test School' },
            { questionId: questions[1]!.id, value: 100 },
            { questionId: questions[2]!.id, value: 'invalid_option' },
          ],
        }),
      ).rejects.toThrow(ValidationError);
    });

    it('should reject duplicate submission', async () => {
      const survey = await setupDistributedSurvey();
      const questions = survey.questions;

      await service.submitSurvey(tenantId, {
        surveyId: survey.id,
        institutionId: 'inst-001',
        answers: [
          { questionId: questions[0]!.id, value: 'Test School' },
          { questionId: questions[1]!.id, value: 500 },
          { questionId: questions[2]!.id, value: 'primary' },
        ],
      });

      await expect(
        service.submitSurvey(tenantId, {
          surveyId: survey.id,
          institutionId: 'inst-001',
          answers: [
            { questionId: questions[0]!.id, value: 'Test School' },
            { questionId: questions[1]!.id, value: 500 },
            { questionId: questions[2]!.id, value: 'primary' },
          ],
        }),
      ).rejects.toThrow(BusinessRuleError);
    });

    it('should reject submission for non-distributed institution', async () => {
      const survey = await setupDistributedSurvey();

      await expect(
        service.submitSurvey(tenantId, {
          surveyId: survey.id,
          institutionId: 'inst-999',
          answers: [],
        }),
      ).rejects.toThrow(NotFoundError);
    });
  });

  // ─── Completion Tracking & Reminders Tests ───────────────────────────────

  describe('getCompletionStatus', () => {
    it('should return correct completion statistics', async () => {
      const survey = await service.createSurvey(tenantId, {
        name: 'Status Test',
        questions: [{ label: 'Q1', type: 'text' as const, order: 0 }],
      });
      await service.updateSurvey(tenantId, survey.id, { status: 'published' });

      institutionLookup.addInstitution({
        id: 'inst-001',
        tenantId,
        areaId: 'a1',
        areaName: 'A',
        typeId: 't1',
        typeName: 'T',
        classificationId: 'c1',
        name: 'S1',
      });
      institutionLookup.addInstitution({
        id: 'inst-002',
        tenantId,
        areaId: 'a1',
        areaName: 'A',
        typeId: 't1',
        typeName: 'T',
        classificationId: 'c1',
        name: 'S2',
      });

      await service.distributeSurvey(tenantId, {
        surveyId: survey.id,
        filters: {},
      });

      // Submit for one institution
      await service.submitSurvey(tenantId, {
        surveyId: survey.id,
        institutionId: 'inst-001',
        answers: [{ questionId: survey.questions[0]!.id, value: 'answer' }],
      });

      const status = await service.getCompletionStatus(tenantId, survey.id);
      expect(status.total).toBe(2);
      expect(status.completed).toBe(1);
      expect(status.pending).toBe(1);
      expect(status.completionRate).toBe(50);
    });
  });

  describe('sendReminders', () => {
    it('should send reminders to incomplete institutions', async () => {
      const survey = await service.createSurvey(tenantId, {
        name: 'Reminder Test',
        questions: [{ label: 'Q1', type: 'text' as const, order: 0 }],
      });
      await service.updateSurvey(tenantId, survey.id, { status: 'published' });

      institutionLookup.addInstitution({
        id: 'inst-001',
        tenantId,
        areaId: 'a1',
        areaName: 'A',
        typeId: 't1',
        typeName: 'T',
        classificationId: 'c1',
        name: 'S1',
      });
      institutionLookup.addInstitution({
        id: 'inst-002',
        tenantId,
        areaId: 'a1',
        areaName: 'A',
        typeId: 't1',
        typeName: 'T',
        classificationId: 'c1',
        name: 'S2',
      });

      await service.distributeSurvey(tenantId, {
        surveyId: survey.id,
        filters: {},
      });

      const result = await service.sendReminders(tenantId, survey.id);
      expect(result.remindersSent).toBe(2);
    });

    it('should return 0 when all submissions are complete', async () => {
      const survey = await service.createSurvey(tenantId, {
        name: 'All Complete',
        questions: [{ label: 'Q1', type: 'text' as const, order: 0 }],
      });
      await service.updateSurvey(tenantId, survey.id, { status: 'published' });

      institutionLookup.addInstitution({
        id: 'inst-001',
        tenantId,
        areaId: 'a1',
        areaName: 'A',
        typeId: 't1',
        typeName: 'T',
        classificationId: 'c1',
        name: 'S1',
      });

      await service.distributeSurvey(tenantId, {
        surveyId: survey.id,
        filters: {},
      });

      await service.submitSurvey(tenantId, {
        surveyId: survey.id,
        institutionId: 'inst-001',
        answers: [{ questionId: survey.questions[0]!.id, value: 'done' }],
      });

      const result = await service.sendReminders(tenantId, survey.id);
      expect(result.remindersSent).toBe(0);
    });
  });

  // ─── Aggregation Tests ───────────────────────────────────────────────────

  describe('aggregateResponses', () => {
    it('should aggregate responses with cross-tabulation by area', async () => {
      const survey = await service.createSurvey(tenantId, {
        name: 'Aggregation Test',
        questions: [
          { label: 'Student Count', type: 'number' as const, required: true, order: 0 },
          {
            label: 'School Type',
            type: 'dropdown' as const,
            order: 1,
            options: [
              { label: 'Primary', value: 'primary' },
              { label: 'Secondary', value: 'secondary' },
            ],
          },
        ],
      });
      await service.updateSurvey(tenantId, survey.id, { status: 'published' });

      institutionLookup.addInstitution({
        id: 'inst-001',
        tenantId,
        areaId: 'area-001',
        areaName: 'District A',
        typeId: 'type-001',
        typeName: 'Primary',
        classificationId: 'c1',
        name: 'School 1',
      });
      institutionLookup.addInstitution({
        id: 'inst-002',
        tenantId,
        areaId: 'area-002',
        areaName: 'District B',
        typeId: 'type-001',
        typeName: 'Primary',
        classificationId: 'c1',
        name: 'School 2',
      });

      await service.distributeSurvey(tenantId, { surveyId: survey.id, filters: {} });

      // Submit responses
      await service.submitSurvey(tenantId, {
        surveyId: survey.id,
        institutionId: 'inst-001',
        answers: [
          { questionId: survey.questions[0]!.id, value: 200 },
          { questionId: survey.questions[1]!.id, value: 'primary' },
        ],
      });
      await service.submitSurvey(tenantId, {
        surveyId: survey.id,
        institutionId: 'inst-002',
        answers: [
          { questionId: survey.questions[0]!.id, value: 300 },
          { questionId: survey.questions[1]!.id, value: 'secondary' },
        ],
      });

      const result = await service.aggregateResponses(tenantId, survey.id, 'area');

      expect(result.totalDistributed).toBe(2);
      expect(result.totalCompleted).toBe(2);
      expect(result.completionRate).toBe(100);
      expect(result.questionSummaries).toHaveLength(2);
      expect(result.crossTabulation).toHaveLength(2);
      expect(result.crossTabulation![0]!.groupLabel).toBe('District A');
    });

    it('should aggregate number questions with statistics', async () => {
      const survey = await service.createSurvey(tenantId, {
        name: 'Number Aggregation',
        questions: [{ label: 'Count', type: 'number' as const, order: 0 }],
      });
      await service.updateSurvey(tenantId, survey.id, { status: 'published' });

      institutionLookup.addInstitution({
        id: 'inst-001',
        tenantId,
        areaId: 'a1',
        areaName: 'A',
        typeId: 't1',
        typeName: 'T',
        classificationId: 'c1',
        name: 'S1',
      });
      institutionLookup.addInstitution({
        id: 'inst-002',
        tenantId,
        areaId: 'a1',
        areaName: 'A',
        typeId: 't1',
        typeName: 'T',
        classificationId: 'c1',
        name: 'S2',
      });

      await service.distributeSurvey(tenantId, { surveyId: survey.id, filters: {} });

      await service.submitSurvey(tenantId, {
        surveyId: survey.id,
        institutionId: 'inst-001',
        answers: [{ questionId: survey.questions[0]!.id, value: 100 }],
      });
      await service.submitSurvey(tenantId, {
        surveyId: survey.id,
        institutionId: 'inst-002',
        answers: [{ questionId: survey.questions[0]!.id, value: 300 }],
      });

      const result = await service.aggregateResponses(tenantId, survey.id);
      const summary = result.questionSummaries[0]!.summary as {
        totalResponses: number;
        average: number;
        min: number;
        max: number;
        sum: number;
      };

      expect(summary.totalResponses).toBe(2);
      expect(summary.average).toBe(200);
      expect(summary.min).toBe(100);
      expect(summary.max).toBe(300);
      expect(summary.sum).toBe(400);
    });
  });

  describe('lifecycle guards (PRC-M388)', () => {
    async function publishedDistributed(extra: { startDate?: string; endDate?: string } = {}) {
      const survey = await service.createSurvey(tenantId, {
        name: `Lifecycle ${Math.random()}`,
        questions: [{ label: 'Q1', type: 'text' as const, required: true, order: 0 }],
        ...extra,
      });
      await service.updateSurvey(tenantId, survey.id, { status: 'published' });
      institutionLookup.addInstitution({
        id: 'inst-lc',
        tenantId,
        areaId: 'area-001',
        areaName: 'District A',
        typeId: 'type-001',
        typeName: 'Primary',
        classificationId: 'class-001',
        name: 'School LC',
      });
      await service.distributeSurvey(tenantId, { surveyId: survey.id, filters: {} });
      return (await service.getSurvey(tenantId, survey.id))!;
    }
    const answer = (qid: string) => [{ questionId: qid, value: 'x' }];

    it('rejects submissions to a closed survey (422)', async () => {
      const survey = await publishedDistributed();
      await service.updateSurvey(tenantId, survey.id, { status: 'closed' });
      const err = await service
        .submitSurvey(tenantId, {
          surveyId: survey.id,
          institutionId: 'inst-lc',
          answers: answer(survey.questions[0]!.id),
        })
        .catch((e: unknown) => e);
      expect(err).toBeInstanceOf(BusinessRuleError);
      expect((err as BusinessRuleError).statusCode).toBe(422);
    });

    it('rejects submissions to a draft survey', async () => {
      const survey = await service.createSurvey(tenantId, {
        name: 'Draft only',
        questions: [{ label: 'Q1', type: 'text' as const, order: 0 }],
      });
      await expect(
        service.submitSurvey(tenantId, {
          surveyId: survey.id,
          institutionId: 'inst-lc',
          answers: answer(survey.questions[0]!.id),
        }),
      ).rejects.toThrow(BusinessRuleError);
    });

    it('rejects submissions outside the start/end window', async () => {
      const past = await publishedDistributed({ endDate: '2000-01-01' });
      await expect(
        service.submitSurvey(tenantId, {
          surveyId: past.id,
          institutionId: 'inst-lc',
          answers: answer(past.questions[0]!.id),
        }),
      ).rejects.toThrow(/window has closed/);
      const future = await publishedDistributed({ startDate: '2999-01-01' });
      await expect(
        service.submitSurvey(tenantId, {
          surveyId: future.id,
          institutionId: 'inst-lc',
          answers: answer(future.questions[0]!.id),
        }),
      ).rejects.toThrow(/not open/);
    });

    it('keeps question ids stable on edit after submissions and forbids question changes', async () => {
      const survey = await publishedDistributed();
      const qid = survey.questions[0]!.id;
      await service.submitSurvey(tenantId, {
        surveyId: survey.id,
        institutionId: 'inst-lc',
        answers: answer(qid),
      });
      const renamed = await service.updateSurvey(tenantId, survey.id, {
        name: 'Renamed',
        questions: [{ label: 'Q1', type: 'text', required: true, order: 0 }],
      });
      expect(renamed.questions[0]!.id).toBe(qid);
      await expect(
        service.updateSurvey(tenantId, survey.id, {
          questions: [{ label: 'Changed', type: 'text', required: true, order: 0 }],
        }),
      ).rejects.toThrow(BusinessRuleError);
    });

    it('preserves explicit question ids on a draft edit', async () => {
      const survey = await service.createSurvey(tenantId, {
        name: 'Draft ids',
        questions: [{ label: 'Q1', type: 'text' as const, order: 0 }],
      });
      const qid = survey.questions[0]!.id;
      const updated = await service.updateSurvey(tenantId, survey.id, {
        questions: [
          { id: qid, label: 'Q1 reworded', type: 'text', order: 0 },
          { label: 'Q2', type: 'text', order: 1 },
        ],
      });
      expect(updated.questions[0]!.id).toBe(qid);
      expect(updated.questions[1]!.id).not.toBe(qid);
    });

    it('double distribute yields one record per institution', async () => {
      const survey = await publishedDistributed();
      await service.distributeSurvey(tenantId, { surveyId: survey.id, filters: {} });
      const records = await distributionRepo.findBySurvey(tenantId, survey.id);
      expect(records.filter((r) => r.institutionId === 'inst-lc')).toHaveLength(1);
    });
  });
});
