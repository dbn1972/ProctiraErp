/**
 * Health Routes Integration Tests
 *
 * Tests the Fastify plugin registration and HTTP route handling.
 */
import { describe, it, expect, beforeEach } from 'vitest';
import Fastify from 'fastify';
import type { FastifyInstance } from 'fastify';

import { healthPlugin } from './health-plugin.js';
import { InMemoryHealthRepository } from './in-memory-repository.js';
import type { HealthAccessContext } from './health-service.js';

describe('Health Routes', () => {
  let app: FastifyInstance;
  let repository: InMemoryHealthRepository;

  const healthOfficerContext: HealthAccessContext = {
    userId: 'user-health-officer',
    roles: ['health_officer'],
    guardianOfStudentIds: [],
  };

  beforeEach(async () => {
    repository = new InMemoryHealthRepository();
    app = Fastify();

    // Simulate tenant and access context middleware
    app.decorateRequest('tenantId', '');
    app.decorateRequest('healthAccessContext', null);
    app.addHook('onRequest', async (request) => {
      (request as any).tenantId = 'tenant-001';
      (request as any).healthAccessContext = healthOfficerContext;
    });

    await app.register(healthPlugin, { repository });
    await app.ready();
  });

  describe('POST /health/measurements', () => {
    it('creates a measurement and returns 201', async () => {
      const response = await app.inject({
        method: 'POST',
        url: '/health/measurements',
        payload: {
          studentId: 'a1b2c3d4-e5f6-4a7b-8c9d-0e1f2a3b4c5d',
          date: '2024-03-15',
          height: 165,
          weight: 55,
        },
      });

      expect(response.statusCode).toBe(201);
      const body = JSON.parse(response.body);
      expect(body.height).toBe(165);
      expect(body.weight).toBe(55);
      expect(body.id).toBeDefined();
    });

    it('returns 400 for invalid payload', async () => {
      const response = await app.inject({
        method: 'POST',
        url: '/health/measurements',
        payload: {
          studentId: 'a1b2c3d4-e5f6-4a7b-8c9d-0e1f2a3b4c5d',
          date: 'invalid-date',
        },
      });

      expect(response.statusCode).toBe(400);
      const body = JSON.parse(response.body);
      expect(body.code).toBe('VALIDATION_ERROR');
    });
  });

  describe('GET /health/measurements/student/:studentId', () => {
    it('lists measurements for a student', async () => {
      // Create a measurement first
      await app.inject({
        method: 'POST',
        url: '/health/measurements',
        payload: {
          studentId: 'a1b2c3d4-e5f6-4a7b-8c9d-0e1f2a3b4c5d',
          date: '2024-03-15',
          height: 165,
        },
      });

      const response = await app.inject({
        method: 'GET',
        url: '/health/measurements/student/a1b2c3d4-e5f6-4a7b-8c9d-0e1f2a3b4c5d',
      });

      expect(response.statusCode).toBe(200);
      const body = JSON.parse(response.body);
      expect(body.data).toHaveLength(1);
      expect(body.meta.totalItems).toBe(1);
    });
  });

  describe('POST /health/allergies', () => {
    it('creates an allergy and returns 201', async () => {
      const response = await app.inject({
        method: 'POST',
        url: '/health/allergies',
        payload: {
          studentId: 'a1b2c3d4-e5f6-4a7b-8c9d-0e1f2a3b4c5d',
          allergyType: 'food',
          description: 'Peanut allergy',
          severity: 'severe',
        },
      });

      expect(response.statusCode).toBe(201);
      const body = JSON.parse(response.body);
      expect(body.allergyType).toBe('food');
      expect(body.severity).toBe('severe');
    });
  });

  describe('POST /health/counselling/sessions', () => {
    it('creates a counselling session', async () => {
      const response = await app.inject({
        method: 'POST',
        url: '/health/counselling/sessions',
        payload: {
          studentId: 'a1b2c3d4-e5f6-4a7b-8c9d-0e1f2a3b4c5d',
          counsellorId: 'b2c3d4e5-f6a7-4b8c-9d0e-1f2a3b4c5d6e',
          sessionDate: '2024-03-20',
          sessionType: 'individual',
          reason: 'Exam anxiety',
          caseNotes: 'Discussed coping strategies',
          followUpRequired: false,
          status: 'completed',
        },
      });

      expect(response.statusCode).toBe(201);
      const body = JSON.parse(response.body);
      expect(body.sessionType).toBe('individual');
      expect(body.status).toBe('completed');
    });
  });

  describe('POST /health/screening-programs', () => {
    it('creates a screening program', async () => {
      const response = await app.inject({
        method: 'POST',
        url: '/health/screening-programs',
        payload: {
          name: 'Grade 1 Vision Screening',
          gradeLevel: 'Grade 1',
          academicPeriodId: 'c3d4e5f6-a7b8-4c9d-0e1f-2a3b4c5d6e7f',
          assessmentTypes: ['vision', 'hearing'],
          status: 'planned',
        },
      });

      expect(response.statusCode).toBe(201);
      const body = JSON.parse(response.body);
      expect(body.name).toBe('Grade 1 Vision Screening');
      expect(body.assessmentTypes).toEqual(['vision', 'hearing']);
    });
  });

  describe('GET /health/screening-programs', () => {
    it('lists screening programs with grade filter', async () => {
      await app.inject({
        method: 'POST',
        url: '/health/screening-programs',
        payload: {
          name: 'Grade 1 Vision',
          gradeLevel: 'Grade 1',
          academicPeriodId: 'c3d4e5f6-a7b8-4c9d-0e1f-2a3b4c5d6e7f',
          assessmentTypes: ['vision'],
          status: 'planned',
        },
      });

      const response = await app.inject({
        method: 'GET',
        url: '/health/screening-programs?gradeLevel=Grade 1',
      });

      expect(response.statusCode).toBe(200);
      const body = JSON.parse(response.body);
      expect(body.data).toHaveLength(1);
    });
  });

  describe('GET /health/dsar/:studentId (G-734)', () => {
    const studentId = 'a1b2c3d4-e5f6-4a7b-8c9d-0e1f2a3b4c5d';

    it('exports a PHI package for an authorized health officer', async () => {
      await app.inject({
        method: 'POST',
        url: '/health/measurements',
        payload: {
          studentId,
          date: '2024-03-15',
          height: 165,
          weight: 55,
        },
      });
      await app.inject({
        method: 'POST',
        url: '/health/allergies',
        payload: {
          studentId,
          allergyType: 'food',
          description: 'Peanut allergy',
          severity: 'severe',
          reaction: 'Anaphylaxis',
        },
      });

      const response = await app.inject({
        method: 'GET',
        url: `/health/dsar/${studentId}`,
      });

      expect(response.statusCode).toBe(200);
      const body = JSON.parse(response.body);
      expect(body.subjectId).toBe(studentId);
      expect(body.tenantId).toBe('tenant-001');
      expect(body.sections.measurements).toHaveLength(1);
      expect(body.sections.allergies).toHaveLength(1);
      expect(body.exportedAt).toBeDefined();
    });

    it('denies DSAR export when the caller lacks health access', async () => {
      // Override access context for this request path via a fresh app hook is
      // heavy — instead swap the decorated context for this inject by
      // temporarily mutating the shared context object.
      healthOfficerContext.roles = [];
      const response = await app.inject({
        method: 'GET',
        url: `/health/dsar/${studentId}`,
      });
      healthOfficerContext.roles = ['health_officer'];
      expect(response.statusCode).toBeGreaterThanOrEqual(400);
    });
  });
});
