/**
 * Integration tests for Assessment Routes
 *
 * Tests the Fastify routes for grading schemes, assessment items, and outcomes.
 *
 * Requirements: 8.1, 8.2, 8.3, 8.6
 */
import { describe, it, expect, beforeEach } from 'vitest';
import Fastify, { type FastifyInstance } from 'fastify';

import { AssessmentService } from './assessment-service.js';
import {
  InMemoryGradingSchemeRepository,
  InMemoryAssessmentItemRepository,
  InMemoryOutcomeRepository,
} from './in-memory-repository.js';
import { registerAssessmentRoutes } from './routes.js';

describe('Assessment Routes', () => {
  let app: FastifyInstance;
  let service: AssessmentService;
  let gradingSchemeRepo: InMemoryGradingSchemeRepository;
  let assessmentItemRepo: InMemoryAssessmentItemRepository;
  let outcomeRepo: InMemoryOutcomeRepository;

  const tenantId = 'tenant-001';

  beforeEach(async () => {
    gradingSchemeRepo = new InMemoryGradingSchemeRepository();
    assessmentItemRepo = new InMemoryAssessmentItemRepository();
    outcomeRepo = new InMemoryOutcomeRepository();
    service = new AssessmentService(gradingSchemeRepo, assessmentItemRepo, outcomeRepo);

    app = Fastify();

    // Add tenant context decorator
    app.decorateRequest('tenantId', '');
    app.addHook('onRequest', async (request) => {
      (request as typeof request & { tenantId: string }).tenantId = tenantId;
    });

    await registerAssessmentRoutes(app, { assessmentService: service });
    await app.ready();
  });

  // ─── Grading Scheme Routes ─────────────────────────────────────────────

  describe('POST /grading-schemes', () => {
    it('should create a grading scheme and return 201', async () => {
      const response = await app.inject({
        method: 'POST',
        url: '/grading-schemes',
        payload: {
          name: 'Standard Scale',
          type: 'numeric',
          minValue: 0,
          maxValue: 100,
          thresholds: [
            { grade: 'A', minScore: 90, maxScore: 100 },
            { grade: 'B', minScore: 80, maxScore: 89 },
            { grade: 'F', minScore: 0, maxScore: 79 },
          ],
        },
      });

      expect(response.statusCode).toBe(201);
      const body = JSON.parse(response.body);
      expect(body.id).toBeDefined();
      expect(body.name).toBe('Standard Scale');
      expect(body.type).toBe('numeric');
      expect(body.thresholds).toHaveLength(3);
    });

    it('should return 400 for invalid payload', async () => {
      const response = await app.inject({
        method: 'POST',
        url: '/grading-schemes',
        payload: {
          // Missing required fields
          type: 'numeric',
        },
      });

      expect(response.statusCode).toBe(400);
      const body = JSON.parse(response.body);
      expect(body.code).toBe('VALIDATION_ERROR');
    });

    it('should return 409 for duplicate name', async () => {
      const payload = {
        name: 'Duplicate',
        type: 'numeric',
        minValue: 0,
        maxValue: 100,
        thresholds: [{ grade: 'A', minScore: 90, maxScore: 100 }],
      };

      await app.inject({ method: 'POST', url: '/grading-schemes', payload });
      const response = await app.inject({ method: 'POST', url: '/grading-schemes', payload });

      expect(response.statusCode).toBe(409);
    });
  });

  describe('GET /grading-schemes', () => {
    it('should list grading schemes', async () => {
      // Create two schemes
      await app.inject({
        method: 'POST',
        url: '/grading-schemes',
        payload: {
          name: 'Scheme A',
          type: 'numeric',
          minValue: 0,
          maxValue: 100,
          thresholds: [{ grade: 'A', minScore: 90, maxScore: 100 }],
        },
      });
      await app.inject({
        method: 'POST',
        url: '/grading-schemes',
        payload: {
          name: 'Scheme B',
          type: 'letter',
          minValue: 0,
          maxValue: 4,
          thresholds: [{ grade: 'A', minScore: 3.7, maxScore: 4 }],
        },
      });

      const response = await app.inject({
        method: 'GET',
        url: '/grading-schemes',
      });

      expect(response.statusCode).toBe(200);
      const body = JSON.parse(response.body);
      expect(body.data).toHaveLength(2);
      expect(body.meta.totalItems).toBe(2);
    });
  });

  describe('GET /grading-schemes/:id', () => {
    it('should return a grading scheme by ID', async () => {
      const createResponse = await app.inject({
        method: 'POST',
        url: '/grading-schemes',
        payload: {
          name: 'Get Test',
          type: 'numeric',
          minValue: 0,
          maxValue: 100,
          thresholds: [{ grade: 'A', minScore: 90, maxScore: 100 }],
        },
      });
      const created = JSON.parse(createResponse.body);

      const response = await app.inject({
        method: 'GET',
        url: `/grading-schemes/${created.id}`,
      });

      expect(response.statusCode).toBe(200);
      const body = JSON.parse(response.body);
      expect(body.id).toBe(created.id);
      expect(body.name).toBe('Get Test');
    });

    it('should return 404 for non-existent scheme', async () => {
      const response = await app.inject({
        method: 'GET',
        url: '/grading-schemes/11111111-1111-4111-8111-111111111111',
      });

      expect(response.statusCode).toBe(404);
    });
  });

  describe('PUT /grading-schemes/:id', () => {
    it('should update a grading scheme', async () => {
      const createResponse = await app.inject({
        method: 'POST',
        url: '/grading-schemes',
        payload: {
          name: 'To Update',
          type: 'numeric',
          minValue: 0,
          maxValue: 100,
          thresholds: [{ grade: 'A', minScore: 90, maxScore: 100 }],
        },
      });
      const created = JSON.parse(createResponse.body);

      const response = await app.inject({
        method: 'PUT',
        url: `/grading-schemes/${created.id}`,
        payload: { name: 'Updated' },
      });

      expect(response.statusCode).toBe(200);
      const body = JSON.parse(response.body);
      expect(body.name).toBe('Updated');
    });
  });

  describe('DELETE /grading-schemes/:id', () => {
    it('should delete a grading scheme and return 204', async () => {
      const createResponse = await app.inject({
        method: 'POST',
        url: '/grading-schemes',
        payload: {
          name: 'To Delete',
          type: 'numeric',
          minValue: 0,
          maxValue: 100,
          thresholds: [{ grade: 'A', minScore: 90, maxScore: 100 }],
        },
      });
      const created = JSON.parse(createResponse.body);

      const response = await app.inject({
        method: 'DELETE',
        url: `/grading-schemes/${created.id}`,
      });

      expect(response.statusCode).toBe(204);
    });
  });

  // ─── Assessment Item Routes ────────────────────────────────────────────

  describe('POST /assessment-items', () => {
    let gradingSchemeId: string;

    beforeEach(async () => {
      const createResponse = await app.inject({
        method: 'POST',
        url: '/grading-schemes',
        payload: {
          name: 'Item Test Scale',
          type: 'numeric',
          minValue: 0,
          maxValue: 100,
          thresholds: [
            { grade: 'A', minScore: 90, maxScore: 100 },
            { grade: 'F', minScore: 0, maxScore: 89 },
          ],
        },
      });
      gradingSchemeId = JSON.parse(createResponse.body).id;
    });

    it('should define assessment items with valid weights summing to 100%', async () => {
      const response = await app.inject({
        method: 'POST',
        url: '/assessment-items',
        payload: {
          subjectId: '11111111-1111-4111-8111-111111111111',
          academicPeriodId: '22222222-2222-4222-8222-222222222222',
          gradingSchemeId,
          items: [
            { name: 'Quiz 1', weight: 25, minScore: 0, maxScore: 100 },
            { name: 'Quiz 2', weight: 25, minScore: 0, maxScore: 100 },
            { name: 'Final Exam', weight: 50, minScore: 0, maxScore: 100 },
          ],
        },
      });

      expect(response.statusCode).toBe(201);
      const body = JSON.parse(response.body);
      expect(body.items).toHaveLength(3);
      expect(body.totalWeight).toBe(100);
    });

    it('should reject items that do not sum to 100%', async () => {
      const response = await app.inject({
        method: 'POST',
        url: '/assessment-items',
        payload: {
          subjectId: '11111111-1111-4111-8111-111111111111',
          academicPeriodId: '22222222-2222-4222-8222-222222222222',
          gradingSchemeId,
          items: [
            { name: 'Quiz', weight: 30, minScore: 0, maxScore: 100 },
            { name: 'Exam', weight: 50, minScore: 0, maxScore: 100 },
          ],
        },
      });

      expect(response.statusCode).toBe(422);
      const body = JSON.parse(response.body);
      expect(body.message).toContain('100%');
    });
  });

  describe('GET /assessment-items', () => {
    it('should return assessment items for a subject+period', async () => {
      const createSchemeResponse = await app.inject({
        method: 'POST',
        url: '/grading-schemes',
        payload: {
          name: 'Get Items Scale',
          type: 'numeric',
          minValue: 0,
          maxValue: 100,
          thresholds: [{ grade: 'A', minScore: 90, maxScore: 100 }],
        },
      });
      const gradingSchemeId = JSON.parse(createSchemeResponse.body).id;

      const subjectId = '11111111-1111-4111-8111-111111111111';
      const academicPeriodId = '22222222-2222-4222-8222-222222222222';

      await app.inject({
        method: 'POST',
        url: '/assessment-items',
        payload: {
          subjectId,
          academicPeriodId,
          gradingSchemeId,
          items: [{ name: 'Test', weight: 100, minScore: 0, maxScore: 100 }],
        },
      });

      const response = await app.inject({
        method: 'GET',
        url: `/assessment-items?subjectId=${subjectId}&academicPeriodId=${academicPeriodId}`,
      });

      expect(response.statusCode).toBe(200);
      const body = JSON.parse(response.body);
      expect(body.items).toHaveLength(1);
      expect(body.totalWeight).toBe(100);
    });
  });

  // ─── Outcome Routes ────────────────────────────────────────────────────

  describe('POST /outcomes', () => {
    it('should create a curriculum outcome', async () => {
      const response = await app.inject({
        method: 'POST',
        url: '/outcomes',
        payload: {
          name: 'Solve Equations',
          code: 'MATH-01',
          description: 'Can solve linear equations',
          subjectId: '11111111-1111-4111-8111-111111111111',
        },
      });

      expect(response.statusCode).toBe(201);
      const body = JSON.parse(response.body);
      expect(body.name).toBe('Solve Equations');
      expect(body.code).toBe('MATH-01');
    });
  });

  describe('GET /outcomes', () => {
    it('should return outcomes for a subject', async () => {
      const subjectId = '11111111-1111-4111-8111-111111111111';

      await app.inject({
        method: 'POST',
        url: '/outcomes',
        payload: { name: 'Outcome 1', code: 'O1', subjectId },
      });
      await app.inject({
        method: 'POST',
        url: '/outcomes',
        payload: { name: 'Outcome 2', code: 'O2', subjectId },
      });

      const response = await app.inject({
        method: 'GET',
        url: `/outcomes?subjectId=${subjectId}`,
      });

      expect(response.statusCode).toBe(200);
      const body = JSON.parse(response.body);
      expect(body.data).toHaveLength(2);
    });

    it('should return 400 if subjectId is missing', async () => {
      const response = await app.inject({
        method: 'GET',
        url: '/outcomes',
      });

      expect(response.statusCode).toBe(400);
    });
  });

  describe('DELETE /outcomes/:id', () => {
    it('should delete an outcome and return 204', async () => {
      const createResponse = await app.inject({
        method: 'POST',
        url: '/outcomes',
        payload: {
          name: 'To Delete',
          code: 'DEL',
          subjectId: '11111111-1111-4111-8111-111111111111',
        },
      });
      const created = JSON.parse(createResponse.body);

      const response = await app.inject({
        method: 'DELETE',
        url: `/outcomes/${created.id}`,
      });

      expect(response.statusCode).toBe(204);
    });
  });
});
