/**
 * Unit tests for Enrollment Routes.
 *
 * Tests cover:
 * - POST /enrollments - Create enrollment
 * - GET /enrollments/:id - Get enrollment
 * - POST /enrollments/:id/status - Update status
 * - POST /enrollments/transfer - Transfer student
 * - GET /enrollments/student/:studentId/history - Get history
 * - GET /enrollments/student/:studentId/transfers - Get transfers
 *
 * Requirements: 6.2, 6.3, 6.4
 */
import { describe, it, expect, beforeEach } from 'vitest';
import Fastify from 'fastify';
import type { FastifyInstance } from 'fastify';

import { InMemoryEnrollmentRepository } from './in-memory-enrollment-repository.js';
import { EnrollmentService } from './enrollment-service.js';
import { registerEnrollmentRoutes } from './enrollment-routes.js';

// Helper to generate valid UUIDs for testing
function uuid(): string {
  return 'xxxxxxxx-xxxx-4xxx-yxxx-xxxxxxxxxxxx'.replace(/[xy]/g, (c) => {
    const r = (Math.random() * 16) | 0;
    const v = c === 'x' ? r : (r & 0x3) | 0x8;
    return v.toString(16);
  });
}

const TENANT_ID = uuid();
const STUDENT_ID = uuid();
const INSTITUTION_ID = uuid();
const GRADE_ID = uuid();
const DEST_CLASS_ID = uuid();
const CLASS_ID = uuid();
const ACADEMIC_PERIOD_ID = uuid();

describe('Enrollment Routes', () => {
  let app: FastifyInstance;
  let repository: InMemoryEnrollmentRepository;

  beforeEach(async () => {
    repository = new InMemoryEnrollmentRepository();
    repository.addInstitution(INSTITUTION_ID, TENANT_ID, 'active');

    const enrollmentService = new EnrollmentService(repository);

    app = Fastify();

    // Add tenantId decorator to simulate tenant resolution
    app.decorateRequest('tenantId', '');
    app.addHook('onRequest', async (request) => {
      (request as unknown as { tenantId: string }).tenantId = TENANT_ID;
    });

    await registerEnrollmentRoutes(app, { enrollmentService });
    await app.ready();
  });

  describe('POST /enrollments', () => {
    it('should create an enrollment and return 201', async () => {
      const response = await app.inject({
        method: 'POST',
        url: '/enrollments',
        payload: {
          studentId: STUDENT_ID,
          institutionId: INSTITUTION_ID,
          gradeId: GRADE_ID,
          classId: CLASS_ID,
          academicPeriodId: ACADEMIC_PERIOD_ID,
          enrolledAt: '2024-01-15',
        },
      });

      expect(response.statusCode).toBe(201);
      const body = JSON.parse(response.body);
      expect(body.studentId).toBe(STUDENT_ID);
      expect(body.institutionId).toBe(INSTITUTION_ID);
      expect(body.status).toBe('ENROLLED');
      expect(body.enrolledAt).toBe('2024-01-15');
    });

    it('should return 400 for invalid payload', async () => {
      const response = await app.inject({
        method: 'POST',
        url: '/enrollments',
        payload: {
          studentId: 'not-a-uuid',
        },
      });

      expect(response.statusCode).toBe(400);
      const body = JSON.parse(response.body);
      expect(body.code).toBe('VALIDATION_ERROR');
    });
  });

  describe('GET /enrollments/:id', () => {
    it('should return an enrollment by ID', async () => {
      // Create an enrollment first
      const createResponse = await app.inject({
        method: 'POST',
        url: '/enrollments',
        payload: {
          studentId: STUDENT_ID,
          institutionId: INSTITUTION_ID,
          gradeId: GRADE_ID,
          classId: CLASS_ID,
          academicPeriodId: ACADEMIC_PERIOD_ID,
          enrolledAt: '2024-01-15',
        },
      });
      const created = JSON.parse(createResponse.body);

      const response = await app.inject({
        method: 'GET',
        url: `/enrollments/${created.id}`,
      });

      expect(response.statusCode).toBe(200);
      const body = JSON.parse(response.body);
      expect(body.id).toBe(created.id);
      expect(body.status).toBe('ENROLLED');
    });

    it('should return 404 for non-existent enrollment', async () => {
      const fakeId = uuid();
      const response = await app.inject({
        method: 'GET',
        url: `/enrollments/${fakeId}`,
      });

      expect(response.statusCode).toBe(404);
    });
  });

  describe('POST /enrollments/:id/status', () => {
    it('should update enrollment status to WITHDRAWN', async () => {
      const createResponse = await app.inject({
        method: 'POST',
        url: '/enrollments',
        payload: {
          studentId: STUDENT_ID,
          institutionId: INSTITUTION_ID,
          gradeId: GRADE_ID,
          classId: CLASS_ID,
          academicPeriodId: ACADEMIC_PERIOD_ID,
          enrolledAt: '2024-01-15',
        },
      });
      const created = JSON.parse(createResponse.body);

      const response = await app.inject({
        method: 'POST',
        url: `/enrollments/${created.id}/status`,
        payload: {
          status: 'WITHDRAWN',
          reason: 'Family relocation',
          effectiveDate: '2024-06-15',
        },
      });

      expect(response.statusCode).toBe(200);
      const body = JSON.parse(response.body);
      expect(body.status).toBe('WITHDRAWN');
      expect(body.exitedAt).toBe('2024-06-15');
    });

    it('should return 422 when trying to change status of non-ENROLLED enrollment', async () => {
      const createResponse = await app.inject({
        method: 'POST',
        url: '/enrollments',
        payload: {
          studentId: STUDENT_ID,
          institutionId: INSTITUTION_ID,
          gradeId: GRADE_ID,
          classId: CLASS_ID,
          academicPeriodId: ACADEMIC_PERIOD_ID,
          enrolledAt: '2024-01-15',
        },
      });
      const created = JSON.parse(createResponse.body);

      // Withdraw first
      await app.inject({
        method: 'POST',
        url: `/enrollments/${created.id}/status`,
        payload: {
          status: 'WITHDRAWN',
          reason: 'First withdrawal',
          effectiveDate: '2024-06-15',
        },
      });

      // Try to graduate
      const response = await app.inject({
        method: 'POST',
        url: `/enrollments/${created.id}/status`,
        payload: {
          status: 'GRADUATED',
          reason: 'Should fail',
          effectiveDate: '2024-06-20',
        },
      });

      expect(response.statusCode).toBe(422);
    });
  });

  describe('POST /enrollments/transfer', () => {
    const DEST_INSTITUTION_ID = uuid();
    const DEST_GRADE_ID = uuid();

    beforeEach(() => {
      repository.addInstitution(DEST_INSTITUTION_ID, TENANT_ID, 'active');
    });

    it('should transfer a student and return 201', async () => {
      const createResponse = await app.inject({
        method: 'POST',
        url: '/enrollments',
        payload: {
          studentId: STUDENT_ID,
          institutionId: INSTITUTION_ID,
          gradeId: GRADE_ID,
          classId: CLASS_ID,
          academicPeriodId: ACADEMIC_PERIOD_ID,
          enrolledAt: '2024-01-15',
        },
      });
      const created = JSON.parse(createResponse.body);

      const response = await app.inject({
        method: 'POST',
        url: '/enrollments/transfer',
        payload: {
          studentId: STUDENT_ID,
          sourceEnrollmentId: created.id,
          destinationInstitutionId: DEST_INSTITUTION_ID,
          destinationGradeId: DEST_GRADE_ID,
          destinationClassId: DEST_CLASS_ID,
          academicPeriodId: ACADEMIC_PERIOD_ID,
          transferDate: '2024-03-01',
          reason: 'Family relocation',
        },
      });

      expect(response.statusCode).toBe(201);
      const body = JSON.parse(response.body);
      expect(body.sourceEnrollment.status).toBe('TRANSFERRED');
      expect(body.destinationEnrollment.status).toBe('ENROLLED');
      expect(body.destinationEnrollment.institutionId).toBe(DEST_INSTITUTION_ID);
      expect(body.transferRecord.sourceInstitutionId).toBe(INSTITUTION_ID);
      expect(body.transferRecord.destinationInstitutionId).toBe(DEST_INSTITUTION_ID);
    });

    it('should return 422 when destination institution does not exist', async () => {
      const createResponse = await app.inject({
        method: 'POST',
        url: '/enrollments',
        payload: {
          studentId: STUDENT_ID,
          institutionId: INSTITUTION_ID,
          gradeId: GRADE_ID,
          classId: CLASS_ID,
          academicPeriodId: ACADEMIC_PERIOD_ID,
          enrolledAt: '2024-01-15',
        },
      });
      const created = JSON.parse(createResponse.body);

      const nonExistentId = uuid();
      const response = await app.inject({
        method: 'POST',
        url: '/enrollments/transfer',
        payload: {
          studentId: STUDENT_ID,
          sourceEnrollmentId: created.id,
          destinationInstitutionId: nonExistentId,
          destinationGradeId: DEST_GRADE_ID,
          destinationClassId: DEST_CLASS_ID,
          academicPeriodId: ACADEMIC_PERIOD_ID,
          transferDate: '2024-03-01',
          reason: 'Family relocation',
        },
      });

      expect(response.statusCode).toBe(422);
      const body = JSON.parse(response.body);
      expect(body.message).toContain('does not exist');
    });

    it('should return 422 when destination institution is inactive', async () => {
      const inactiveId = uuid();
      repository.addInstitution(inactiveId, TENANT_ID, 'inactive');

      const createResponse = await app.inject({
        method: 'POST',
        url: '/enrollments',
        payload: {
          studentId: STUDENT_ID,
          institutionId: INSTITUTION_ID,
          gradeId: GRADE_ID,
          classId: CLASS_ID,
          academicPeriodId: ACADEMIC_PERIOD_ID,
          enrolledAt: '2024-01-15',
        },
      });
      const created = JSON.parse(createResponse.body);

      const response = await app.inject({
        method: 'POST',
        url: '/enrollments/transfer',
        payload: {
          studentId: STUDENT_ID,
          sourceEnrollmentId: created.id,
          destinationInstitutionId: inactiveId,
          destinationGradeId: DEST_GRADE_ID,
          destinationClassId: DEST_CLASS_ID,
          academicPeriodId: ACADEMIC_PERIOD_ID,
          transferDate: '2024-03-01',
          reason: 'Family relocation',
        },
      });

      expect(response.statusCode).toBe(422);
      const body = JSON.parse(response.body);
      expect(body.message).toContain('inactive');
    });
  });

  describe('GET /enrollments/student/:studentId/history', () => {
    it('should return enrollment history for a student', async () => {
      // Create and then withdraw an enrollment
      const createResponse = await app.inject({
        method: 'POST',
        url: '/enrollments',
        payload: {
          studentId: STUDENT_ID,
          institutionId: INSTITUTION_ID,
          gradeId: GRADE_ID,
          classId: CLASS_ID,
          academicPeriodId: ACADEMIC_PERIOD_ID,
          enrolledAt: '2024-01-15',
        },
      });
      const created = JSON.parse(createResponse.body);

      await app.inject({
        method: 'POST',
        url: `/enrollments/${created.id}/status`,
        payload: {
          status: 'WITHDRAWN',
          reason: 'Personal reasons',
          effectiveDate: '2024-06-15',
        },
      });

      const response = await app.inject({
        method: 'GET',
        url: `/enrollments/student/${STUDENT_ID}/history`,
      });

      expect(response.statusCode).toBe(200);
      const body = JSON.parse(response.body);
      expect(body.data).toHaveLength(2);
      // Most recent first
      expect(body.data[0].newStatus).toBe('WITHDRAWN');
      expect(body.data[0].previousStatus).toBe('ENROLLED');
      expect(body.data[1].newStatus).toBe('ENROLLED');
      expect(body.data[1].previousStatus).toBeNull();
    });
  });

  describe('GET /enrollments/student/:studentId/transfers', () => {
    it('should return transfer records for a student', async () => {
      const destId = uuid();
      repository.addInstitution(destId, TENANT_ID, 'active');

      const createResponse = await app.inject({
        method: 'POST',
        url: '/enrollments',
        payload: {
          studentId: STUDENT_ID,
          institutionId: INSTITUTION_ID,
          gradeId: GRADE_ID,
          classId: CLASS_ID,
          academicPeriodId: ACADEMIC_PERIOD_ID,
          enrolledAt: '2024-01-15',
        },
      });
      const created = JSON.parse(createResponse.body);

      await app.inject({
        method: 'POST',
        url: '/enrollments/transfer',
        payload: {
          studentId: STUDENT_ID,
          sourceEnrollmentId: created.id,
          destinationInstitutionId: destId,
          destinationGradeId: GRADE_ID,
          destinationClassId: DEST_CLASS_ID,
          academicPeriodId: ACADEMIC_PERIOD_ID,
          transferDate: '2024-03-01',
          reason: 'Family relocation',
        },
      });

      const response = await app.inject({
        method: 'GET',
        url: `/enrollments/student/${STUDENT_ID}/transfers`,
      });

      expect(response.statusCode).toBe(200);
      const body = JSON.parse(response.body);
      expect(body.data).toHaveLength(1);
      expect(body.data[0].studentId).toBe(STUDENT_ID);
      expect(body.data[0].reason).toBe('Family relocation');
    });
  });
});
