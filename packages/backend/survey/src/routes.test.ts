/**
 * Route integration tests for Survey Service
 *
 * Tests the Fastify routes for survey CRUD, distribution,
 * submission, and aggregation endpoints.
 *
 * Requirements: 23.1, 23.2, 23.3, 23.4, 23.5
 */
import { describe, it, expect, beforeEach } from 'vitest';
import Fastify, { type FastifyInstance } from 'fastify';

import { SurveyService } from './survey-service.js';
import { registerSurveyRoutes } from './routes.js';
import {
  InMemorySurveyRepository,
  InMemoryDistributionRepository,
  InMemorySubmissionRepository,
  InMemoryInstitutionLookup,
} from './in-memory-repository.js';

describe('Survey Routes', () => {
  let app: FastifyInstance;
  let surveyService: SurveyService;
  let institutionLookup: InMemoryInstitutionLookup;

  const tenantId = 'tenant-001';

  beforeEach(async () => {
    const surveyRepo = new InMemorySurveyRepository();
    const distributionRepo = new InMemoryDistributionRepository();
    const submissionRepo = new InMemorySubmissionRepository();
    institutionLookup = new InMemoryInstitutionLookup();

    surveyService = new SurveyService(
      surveyRepo,
      distributionRepo,
      submissionRepo,
      institutionLookup,
      null,
    );

    app = Fastify();
    // Add tenant context decorator
    app.decorateRequest('tenantId', '');
    app.addHook('onRequest', async (request) => {
      (request as unknown as { tenantId: string }).tenantId = tenantId;
    });

    await registerSurveyRoutes(app, { surveyService });
    await app.ready();
  });

  describe('POST /surveys', () => {
    it('should create a survey and return 201', async () => {
      const response = await app.inject({
        method: 'POST',
        url: '/surveys',
        payload: {
          name: 'Test Survey',
          questions: [
            { label: 'Question 1', type: 'text', required: true, order: 0 },
          ],
        },
      });

      expect(response.statusCode).toBe(201);
      const body = JSON.parse(response.body);
      expect(body.name).toBe('Test Survey');
      expect(body.status).toBe('draft');
      expect(body.questions).toHaveLength(1);
    });

    it('should return 400 for invalid payload', async () => {
      const response = await app.inject({
        method: 'POST',
        url: '/surveys',
        payload: {
          name: '',
          questions: [],
        },
      });

      expect(response.statusCode).toBe(400);
      const body = JSON.parse(response.body);
      expect(body.code).toBe('VALIDATION_ERROR');
    });

    it('should return 409 for duplicate name', async () => {
      await app.inject({
        method: 'POST',
        url: '/surveys',
        payload: {
          name: 'Duplicate',
          questions: [{ label: 'Q1', type: 'text', order: 0 }],
        },
      });

      const response = await app.inject({
        method: 'POST',
        url: '/surveys',
        payload: {
          name: 'Duplicate',
          questions: [{ label: 'Q1', type: 'text', order: 0 }],
        },
      });

      expect(response.statusCode).toBe(409);
    });
  });

  describe('GET /surveys', () => {
    it('should list surveys with pagination', async () => {
      await app.inject({
        method: 'POST',
        url: '/surveys',
        payload: {
          name: 'Survey 1',
          questions: [{ label: 'Q1', type: 'text', order: 0 }],
        },
      });

      const response = await app.inject({
        method: 'GET',
        url: '/surveys',
      });

      expect(response.statusCode).toBe(200);
      const body = JSON.parse(response.body);
      expect(body.data).toHaveLength(1);
      expect(body.meta.totalItems).toBe(1);
    });
  });

  describe('GET /surveys/:id', () => {
    it('should return a survey by ID', async () => {
      const createRes = await app.inject({
        method: 'POST',
        url: '/surveys',
        payload: {
          name: 'Get Test',
          questions: [{ label: 'Q1', type: 'text', order: 0 }],
        },
      });
      const created = JSON.parse(createRes.body);

      const response = await app.inject({
        method: 'GET',
        url: `/surveys/${created.id}`,
      });

      expect(response.statusCode).toBe(200);
      const body = JSON.parse(response.body);
      expect(body.id).toBe(created.id);
      expect(body.name).toBe('Get Test');
    });

    it('should return 400 for invalid UUID', async () => {
      const response = await app.inject({
        method: 'GET',
        url: '/surveys/not-a-uuid',
      });

      expect(response.statusCode).toBe(400);
    });
  });

  describe('DELETE /surveys/:id', () => {
    it('should delete a survey and return 204', async () => {
      const createRes = await app.inject({
        method: 'POST',
        url: '/surveys',
        payload: {
          name: 'Delete Test',
          questions: [{ label: 'Q1', type: 'text', order: 0 }],
        },
      });
      const created = JSON.parse(createRes.body);

      const response = await app.inject({
        method: 'DELETE',
        url: `/surveys/${created.id}`,
      });

      expect(response.statusCode).toBe(204);
    });
  });

  describe('POST /surveys/distribute', () => {
    it('should distribute a published survey', async () => {
      const createRes = await app.inject({
        method: 'POST',
        url: '/surveys',
        payload: {
          name: 'Distribute Test',
          questions: [{ label: 'Q1', type: 'text', order: 0 }],
        },
      });
      const created = JSON.parse(createRes.body);

      // Publish the survey
      await app.inject({
        method: 'PUT',
        url: `/surveys/${created.id}`,
        payload: { status: 'published' },
      });

      const areaId = '11111111-1111-4111-8111-111111111111';
      // Add institutions
      institutionLookup.addInstitution({
        id: 'inst-001', tenantId, areaId, areaName: 'Area 1',
        typeId: 't1', typeName: 'Type 1', classificationId: 'c1', name: 'School 1',
      });

      const response = await app.inject({
        method: 'POST',
        url: '/surveys/distribute',
        payload: {
          surveyId: created.id,
          filters: { areaIds: [areaId] },
        },
      });

      expect(response.statusCode).toBe(201);
      const body = JSON.parse(response.body);
      expect(body.distributed).toBe(1);
    });
  });

  describe('POST /surveys/submit', () => {
    it('should submit survey responses', async () => {
      const instId = '22222222-2222-4222-8222-222222222222';

      const createRes = await app.inject({
        method: 'POST',
        url: '/surveys',
        payload: {
          name: 'Submit Test',
          questions: [{ label: 'Q1', type: 'text', order: 0 }],
        },
      });
      const created = JSON.parse(createRes.body);

      await app.inject({
        method: 'PUT',
        url: `/surveys/${created.id}`,
        payload: { status: 'published' },
      });

      institutionLookup.addInstitution({
        id: instId, tenantId, areaId: '11111111-1111-4111-8111-111111111111', areaName: 'Area 1',
        typeId: 't1', typeName: 'Type 1', classificationId: 'c1', name: 'School 1',
      });

      await app.inject({
        method: 'POST',
        url: '/surveys/distribute',
        payload: { surveyId: created.id, filters: {} },
      });

      const response = await app.inject({
        method: 'POST',
        url: '/surveys/submit',
        payload: {
          surveyId: created.id,
          institutionId: instId,
          answers: [
            { questionId: created.questions[0].id, value: 'My answer' },
          ],
        },
      });

      expect(response.statusCode).toBe(201);
      const body = JSON.parse(response.body);
      expect(body.surveyId).toBe(created.id);
      expect(body.institutionId).toBe(instId);
    });
  });
});
