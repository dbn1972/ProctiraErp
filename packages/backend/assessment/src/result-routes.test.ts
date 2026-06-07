/**
 * Integration tests for Assessment Result Routes
 *
 * Tests the HTTP layer for result entry, bulk entry, import, and grade calculation.
 *
 * Requirements: 8.4, 8.5, 8.8
 */
import { describe, it, expect, beforeEach } from 'vitest';
import Fastify from 'fastify';
import type { FastifyInstance } from 'fastify';

import { AssessmentService } from './assessment-service.js';
import { ResultService } from './result-service.js';
import {
  InMemoryGradingSchemeRepository,
  InMemoryAssessmentItemRepository,
  InMemoryOutcomeRepository,
} from './in-memory-repository.js';
import { InMemoryAssessmentResultRepository } from './in-memory-result-repository.js';
import { registerAssessmentRoutes } from './routes.js';
import { registerResultRoutes } from './result-routes.js';
import type { AssessmentItemEntity } from './assessment-repository.js';

describe('Assessment Result Routes', () => {
  let app: FastifyInstance;
  let assessmentService: AssessmentService;
  let resultService: ResultService;
  let gradingSchemeRepo: InMemoryGradingSchemeRepository;
  let assessmentItemRepo: InMemoryAssessmentItemRepository;
  let outcomeRepo: InMemoryOutcomeRepository;
  let resultRepo: InMemoryAssessmentResultRepository;

  const tenantId = 'tenant-001';
  const subjectId = '11111111-1111-4111-8111-111111111111';
  const academicPeriodId = '22222222-2222-4222-8222-222222222222';
  const studentId = '33333333-3333-4333-8333-333333333333';

  let gradingSchemeId: string;
  let items: AssessmentItemEntity[];

  beforeEach(async () => {
    gradingSchemeRepo = new InMemoryGradingSchemeRepository();
    assessmentItemRepo = new InMemoryAssessmentItemRepository();
    outcomeRepo = new InMemoryOutcomeRepository();
    resultRepo = new InMemoryAssessmentResultRepository();

    assessmentService = new AssessmentService(
      gradingSchemeRepo,
      assessmentItemRepo,
      outcomeRepo,
    );

    resultService = new ResultService(
      resultRepo,
      assessmentItemRepo,
      gradingSchemeRepo,
    );

    app = Fastify();

    // Add tenant context decorator
    app.decorateRequest('tenantId', '');
    app.addHook('onRequest', async (request) => {
      (request as unknown as { tenantId: string }).tenantId = tenantId;
    });

    await registerAssessmentRoutes(app, { assessmentService });
    await registerResultRoutes(app, { resultService });
    await app.ready();

    // Set up grading scheme and items
    const scheme = await assessmentService.createGradingScheme(tenantId, {
      name: 'Test Scale',
      type: 'numeric',
      minValue: 0,
      maxValue: 100,
      thresholds: [
        { grade: 'A', minScore: 90, maxScore: 100 },
        { grade: 'B', minScore: 80, maxScore: 89 },
        { grade: 'C', minScore: 70, maxScore: 79 },
        { grade: 'D', minScore: 60, maxScore: 69 },
        { grade: 'F', minScore: 0, maxScore: 59 },
      ],
    });
    gradingSchemeId = scheme.id;

    items = await assessmentService.defineAssessmentItems(tenantId, {
      subjectId,
      academicPeriodId,
      gradingSchemeId,
      items: [
        { name: 'Midterm', weight: 40, minScore: 0, maxScore: 100 },
        { name: 'Final', weight: 60, minScore: 0, maxScore: 100 },
      ],
    });
  });

  // ─── POST /results ─────────────────────────────────────────────────────

  describe('POST /results', () => {
    it('should enter a single result and return 201', async () => {
      const response = await app.inject({
        method: 'POST',
        url: '/results',
        payload: {
          subjectId,
          academicPeriodId,
          studentId,
          assessmentItemId: items[0]!.id,
          score: 85,
        },
      });

      expect(response.statusCode).toBe(201);
      const body = JSON.parse(response.body);
      expect(body.studentId).toBe(studentId);
      expect(body.score).toBe(85);
      expect(body.id).toBeDefined();
    });

    it('should return 422 for out-of-range score (Requirement 8.5)', async () => {
      const response = await app.inject({
        method: 'POST',
        url: '/results',
        payload: {
          subjectId,
          academicPeriodId,
          studentId,
          assessmentItemId: items[0]!.id,
          score: 150,
        },
      });

      expect(response.statusCode).toBe(422);
      const body = JSON.parse(response.body);
      expect(body.code).toBe('BUSINESS_RULE_ERROR');
      expect(body.message).toContain('[0, 100]');
    });

    it('should return 404 for non-existent assessment item', async () => {
      const response = await app.inject({
        method: 'POST',
        url: '/results',
        payload: {
          subjectId,
          academicPeriodId,
          studentId,
          assessmentItemId: '99999999-9999-4999-8999-999999999999',
          score: 85,
        },
      });

      expect(response.statusCode).toBe(404);
    });

    it('should return 400 for invalid payload', async () => {
      const response = await app.inject({
        method: 'POST',
        url: '/results',
        payload: {
          subjectId,
          // missing required fields
        },
      });

      expect(response.statusCode).toBe(400);
      const body = JSON.parse(response.body);
      expect(body.code).toBe('VALIDATION_ERROR');
    });
  });

  // ─── POST /results/bulk ────────────────────────────────────────────────

  describe('POST /results/bulk', () => {
    it('should bulk import valid results and return 200', async () => {
      const response = await app.inject({
        method: 'POST',
        url: '/results/bulk',
        payload: {
          subjectId,
          academicPeriodId,
          results: [
            { studentId, assessmentItemId: items[0]!.id, score: 85 },
            { studentId, assessmentItemId: items[1]!.id, score: 90 },
          ],
        },
      });

      expect(response.statusCode).toBe(200);
      const body = JSON.parse(response.body);
      expect(body.totalRows).toBe(2);
      expect(body.successCount).toBe(2);
      expect(body.errorCount).toBe(0);
    });

    it('should return row-level errors for invalid scores (Requirement 8.8)', async () => {
      const response = await app.inject({
        method: 'POST',
        url: '/results/bulk',
        payload: {
          subjectId,
          academicPeriodId,
          results: [
            { studentId, assessmentItemId: items[0]!.id, score: 85 }, // valid
            { studentId, assessmentItemId: items[0]!.id, score: 200 }, // invalid
          ],
        },
      });

      expect(response.statusCode).toBe(200);
      const body = JSON.parse(response.body);
      expect(body.successCount).toBe(1);
      expect(body.errorCount).toBe(1);
      expect(body.errors[0].row).toBe(1);
      expect(body.errors[0].field).toBe('score');
    });
  });

  // ─── POST /results/import ──────────────────────────────────────────────

  describe('POST /results/import', () => {
    it('should import Excel rows and return 200', async () => {
      const response = await app.inject({
        method: 'POST',
        url: '/results/import',
        payload: {
          subjectId,
          academicPeriodId,
          rows: [
            { studentId, assessmentItemId: items[0]!.id, score: 75 },
          ],
        },
      });

      expect(response.statusCode).toBe(200);
      const body = JSON.parse(response.body);
      expect(body.successCount).toBe(1);
    });

    it('should return 400 for missing required fields', async () => {
      const response = await app.inject({
        method: 'POST',
        url: '/results/import',
        payload: {
          subjectId,
          // missing academicPeriodId and rows
        },
      });

      expect(response.statusCode).toBe(400);
    });
  });

  // ─── GET /results/grades ───────────────────────────────────────────────

  describe('GET /results/grades', () => {
    it('should return calculated grade for a student (Requirement 8.4)', async () => {
      // Enter scores
      await resultService.enterSingleResult(tenantId, {
        subjectId, academicPeriodId, studentId,
        assessmentItemId: items[0]!.id, score: 90,
      });
      await resultService.enterSingleResult(tenantId, {
        subjectId, academicPeriodId, studentId,
        assessmentItemId: items[1]!.id, score: 85,
      });

      const response = await app.inject({
        method: 'GET',
        url: `/results/grades?subjectId=${subjectId}&academicPeriodId=${academicPeriodId}&studentId=${studentId}`,
      });

      expect(response.statusCode).toBe(200);
      const body = JSON.parse(response.body);
      expect(body.data).toHaveLength(1);
      expect(body.data[0].studentId).toBe(studentId);
      expect(body.data[0].grade).toBeDefined();
      expect(body.data[0].weightedAverage).toBeDefined();
    });

    it('should return 400 for missing query parameters', async () => {
      const response = await app.inject({
        method: 'GET',
        url: '/results/grades',
      });

      expect(response.statusCode).toBe(400);
    });
  });
});
