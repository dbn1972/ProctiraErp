/**
 * Integration tests for Examination Routes
 *
 * Tests the Fastify routes for examination CRUD operations.
 */
import { describe, it, expect, beforeEach } from 'vitest';
import Fastify from 'fastify';
import type { FastifyInstance } from 'fastify';

import { ExaminationService } from './examination-service.js';
import { InMemoryExaminationRepository } from './in-memory-repository.js';
import { registerExaminationRoutes } from './routes.js';

// Helper to generate a date N days from now in YYYY-MM-DD format
function futureDate(days: number): string {
  const date = new Date();
  date.setDate(date.getDate() + days);
  return date.toISOString().split('T')[0] as string;
}

// Helper to generate a valid UUID v4
function uuid(): string {
  return 'xxxxxxxx-xxxx-4xxx-yxxx-xxxxxxxxxxxx'.replace(/[xy]/g, (c) => {
    const r = (Math.random() * 16) | 0;
    const v = c === 'x' ? r : (r & 0x3) | 0x8;
    return v.toString(16);
  });
}

const TENANT_ID = uuid();

function validExaminationBody() {
  return {
    name: 'National Examination 2025',
    code: `EXAM-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`,
    description: 'Annual national examination',
    academicPeriodId: uuid(),
    startDate: futureDate(14),
    endDate: futureDate(21),
    subjects: [
      { name: 'Mathematics', code: 'MATH', maxScore: 100 },
    ],
    centers: [
      { name: 'Center A', code: 'CTR-A', institutionId: uuid(), capacity: 200 },
    ],
    gradingSchemes: [
      {
        name: 'Standard Grading',
        minScore: 0,
        maxScore: 100,
        passThreshold: 40,
        thresholds: [
          { grade: 'A', minScore: 80, maxScore: 100 },
          { grade: 'B', minScore: 60, maxScore: 79 },
          { grade: 'C', minScore: 40, maxScore: 59 },
          { grade: 'F', minScore: 0, maxScore: 39 },
        ],
      },
    ],
  };
}

describe('Examination Routes', () => {
  let app: FastifyInstance;
  let repository: InMemoryExaminationRepository;

  beforeEach(async () => {
    repository = new InMemoryExaminationRepository();
    const service = new ExaminationService(repository);

    app = Fastify();

    // Add tenantId decorator to simulate tenant resolution
    app.decorateRequest('tenantId', '');
    app.addHook('onRequest', async (request) => {
      (request as any).tenantId = TENANT_ID;
    });

    await registerExaminationRoutes(app, { examinationService: service });
    await app.ready();
  });

  describe('POST /examinations', () => {
    it('should create an examination and return 201', async () => {
      const body = validExaminationBody();

      const response = await app.inject({
        method: 'POST',
        url: '/examinations',
        payload: body,
      });

      expect(response.statusCode).toBe(201);
      const json = response.json();
      expect(json.id).toBeDefined();
      expect(json.name).toBe(body.name);
      expect(json.code).toBe(body.code);
      expect(json.status).toBe('DRAFT');
      expect(json.subjects).toHaveLength(1);
      expect(json.centers).toHaveLength(1);
      expect(json.gradingSchemes).toHaveLength(1);
    });

    it('should return 400 for missing required fields', async () => {
      const response = await app.inject({
        method: 'POST',
        url: '/examinations',
        payload: { name: 'Test' }, // missing required fields
      });

      expect(response.statusCode).toBe(400);
      const json = response.json();
      expect(json.code).toBe('VALIDATION_ERROR');
    });

    it('should return 400 for dates less than 7 days in the future', async () => {
      const body = {
        ...validExaminationBody(),
        startDate: futureDate(3),
      };

      const response = await app.inject({
        method: 'POST',
        url: '/examinations',
        payload: body,
      });

      expect(response.statusCode).toBe(400);
    });

    it('should return 409 for duplicate code', async () => {
      const body = validExaminationBody();
      body.code = 'UNIQUE-CODE';

      await app.inject({
        method: 'POST',
        url: '/examinations',
        payload: body,
      });

      const response = await app.inject({
        method: 'POST',
        url: '/examinations',
        payload: { ...validExaminationBody(), code: 'UNIQUE-CODE' },
      });

      expect(response.statusCode).toBe(409);
    });
  });

  describe('GET /examinations/:id', () => {
    it('should return an examination by ID', async () => {
      const createResponse = await app.inject({
        method: 'POST',
        url: '/examinations',
        payload: validExaminationBody(),
      });
      const created = createResponse.json();

      const response = await app.inject({
        method: 'GET',
        url: `/examinations/${created.id}`,
      });

      expect(response.statusCode).toBe(200);
      expect(response.json().id).toBe(created.id);
    });

    it('should return 404 for non-existent examination', async () => {
      const response = await app.inject({
        method: 'GET',
        url: `/examinations/${uuid()}`,
      });

      expect(response.statusCode).toBe(404);
    });

    it('should return 400 for invalid UUID', async () => {
      const response = await app.inject({
        method: 'GET',
        url: '/examinations/not-a-uuid',
      });

      expect(response.statusCode).toBe(400);
    });
  });

  describe('GET /examinations', () => {
    it('should list examinations', async () => {
      await app.inject({
        method: 'POST',
        url: '/examinations',
        payload: validExaminationBody(),
      });

      const response = await app.inject({
        method: 'GET',
        url: '/examinations',
      });

      expect(response.statusCode).toBe(200);
      const json = response.json();
      expect(json.data).toHaveLength(1);
      expect(json.meta.totalItems).toBe(1);
    });
  });

  describe('PUT /examinations/:id', () => {
    it('should update an examination', async () => {
      const createResponse = await app.inject({
        method: 'POST',
        url: '/examinations',
        payload: validExaminationBody(),
      });
      const created = createResponse.json();

      const response = await app.inject({
        method: 'PUT',
        url: `/examinations/${created.id}`,
        payload: { name: 'Updated Name' },
      });

      expect(response.statusCode).toBe(200);
      expect(response.json().name).toBe('Updated Name');
    });

    it('should return 404 for non-existent examination', async () => {
      const response = await app.inject({
        method: 'PUT',
        url: `/examinations/${uuid()}`,
        payload: { name: 'Test' },
      });

      expect(response.statusCode).toBe(404);
    });
  });

  describe('DELETE /examinations/:id', () => {
    it('should delete a DRAFT examination', async () => {
      const createResponse = await app.inject({
        method: 'POST',
        url: '/examinations',
        payload: validExaminationBody(),
      });
      const created = createResponse.json();

      const response = await app.inject({
        method: 'DELETE',
        url: `/examinations/${created.id}`,
      });

      expect(response.statusCode).toBe(204);

      // Verify it's gone
      const getResponse = await app.inject({
        method: 'GET',
        url: `/examinations/${created.id}`,
      });
      expect(getResponse.statusCode).toBe(404);
    });

    it('should return 404 for non-existent examination', async () => {
      const response = await app.inject({
        method: 'DELETE',
        url: `/examinations/${uuid()}`,
      });

      expect(response.statusCode).toBe(404);
    });
  });
});
