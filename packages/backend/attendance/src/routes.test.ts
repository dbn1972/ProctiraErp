/**
 * Attendance Routes Integration Tests
 *
 * Tests the Fastify routes for attendance recording.
 */
import { describe, it, expect, beforeEach } from 'vitest';
import Fastify from 'fastify';
import type { FastifyInstance } from 'fastify';

import { AttendanceService } from './attendance-service.js';
import { InMemoryAttendanceRepository } from './in-memory-repository.js';
import { registerAttendanceRoutes } from './routes.js';
import type { AcademicPeriodInfo } from './attendance-repository.js';

const TENANT_ID = 'tenant-001';
const INSTITUTION_ID = '11111111-1111-4111-8111-111111111111';
const CLASS_ID = '22222222-2222-4222-8222-222222222222';
const STUDENT_ID = '33333333-3333-4333-8333-333333333333';
const STAFF_ID = '44444444-4444-4444-8444-444444444444';
const PERIOD_ID = '55555555-5555-4555-8555-555555555555';

function createActivePeriod(): AcademicPeriodInfo {
  return {
    id: PERIOD_ID,
    tenantId: TENANT_ID,
    name: 'Academic Year 2024',
    startDate: new Date('2024-01-01'),
    endDate: new Date('2024-12-31'),
    status: 'active',
  };
}

describe('Attendance Routes', () => {
  let app: FastifyInstance;
  let repository: InMemoryAttendanceRepository;

  beforeEach(async () => {
    repository = new InMemoryAttendanceRepository();
    repository.addAcademicPeriod(createActivePeriod());

    const service = new AttendanceService(repository);

    app = Fastify();

    // Add tenant context decorator
    app.decorateRequest('tenantId', '');
    app.addHook('onRequest', async (request) => {
      (request as typeof request & { tenantId: string }).tenantId = TENANT_ID;
    });

    // Add user context
    app.decorateRequest('user', null);
    app.addHook('onRequest', async (request) => {
      (request as typeof request & { user: { sub: string } }).user = { sub: 'test-user' };
    });

    await registerAttendanceRoutes(app, { attendanceService: service });
    await app.ready();
  });

  describe('POST /attendance/student', () => {
    it('should record student attendance and return 201', async () => {
      const response = await app.inject({
        method: 'POST',
        url: '/attendance/student',
        payload: {
          studentId: STUDENT_ID,
          institutionId: INSTITUTION_ID,
          classId: CLASS_ID,
          academicPeriodId: PERIOD_ID,
          date: '2024-06-15',
          status: 'PRESENT',
        },
      });

      expect(response.statusCode).toBe(201);
      const body = JSON.parse(response.body);
      expect(body.studentId).toBe(STUDENT_ID);
      expect(body.status).toBe('PRESENT');
      expect(body.date).toBe('2024-06-15');
    });

    it('should return 400 for invalid payload', async () => {
      const response = await app.inject({
        method: 'POST',
        url: '/attendance/student',
        payload: {
          studentId: 'not-a-uuid',
          date: '2024-06-15',
          status: 'PRESENT',
        },
      });

      expect(response.statusCode).toBe(400);
      const body = JSON.parse(response.body);
      expect(body.code).toBe('VALIDATION_ERROR');
    });

    it('should return 422 for future date', async () => {
      const response = await app.inject({
        method: 'POST',
        url: '/attendance/student',
        payload: {
          studentId: STUDENT_ID,
          institutionId: INSTITUTION_ID,
          classId: CLASS_ID,
          academicPeriodId: PERIOD_ID,
          date: '2099-12-31',
          status: 'PRESENT',
        },
      });

      expect(response.statusCode).toBe(422);
      const body = JSON.parse(response.body);
      expect(body.message).toContain('Future attendance cannot be recorded');
    });
  });

  describe('POST /attendance/student/bulk', () => {
    it('should record bulk attendance and return 201', async () => {
      const response = await app.inject({
        method: 'POST',
        url: '/attendance/student/bulk',
        payload: {
          institutionId: INSTITUTION_ID,
          classId: CLASS_ID,
          academicPeriodId: PERIOD_ID,
          date: '2024-06-15',
          records: [
            { studentId: STUDENT_ID, status: 'PRESENT' },
            { studentId: '88888888-8888-4888-8888-888888888888', status: 'ABSENT' },
          ],
        },
      });

      expect(response.statusCode).toBe(201);
      const body = JSON.parse(response.body);
      expect(body.summary.totalRecorded).toBe(2);
      expect(body.summary.totalErrors).toBe(0);
    });

    it('should return 400 for empty records array', async () => {
      const response = await app.inject({
        method: 'POST',
        url: '/attendance/student/bulk',
        payload: {
          institutionId: INSTITUTION_ID,
          classId: CLASS_ID,
          academicPeriodId: PERIOD_ID,
          date: '2024-06-15',
          records: [],
        },
      });

      expect(response.statusCode).toBe(400);
    });
  });

  describe('POST /attendance/staff', () => {
    it('should record staff attendance and return 201', async () => {
      const response = await app.inject({
        method: 'POST',
        url: '/attendance/staff',
        payload: {
          staffId: STAFF_ID,
          institutionId: INSTITUTION_ID,
          date: '2024-06-15',
          status: 'PRESENT',
        },
      });

      expect(response.statusCode).toBe(201);
      const body = JSON.parse(response.body);
      expect(body.staffId).toBe(STAFF_ID);
      expect(body.status).toBe('PRESENT');
    });

    it('should return 400 for invalid status', async () => {
      const response = await app.inject({
        method: 'POST',
        url: '/attendance/staff',
        payload: {
          staffId: STAFF_ID,
          institutionId: INSTITUTION_ID,
          date: '2024-06-15',
          status: 'INVALID_STATUS',
        },
      });

      expect(response.statusCode).toBe(400);
    });

    it('should return 422 for future date', async () => {
      const response = await app.inject({
        method: 'POST',
        url: '/attendance/staff',
        payload: {
          staffId: STAFF_ID,
          institutionId: INSTITUTION_ID,
          date: '2099-12-31',
          status: 'PRESENT',
        },
      });

      expect(response.statusCode).toBe(422);
    });
  });

  describe('GET /attendance/roster', () => {
    it('should return class roster', async () => {
      repository.addRosterEntry({
        studentId: STUDENT_ID,
        studentName: 'John Doe',
        enrollmentId: 'enr-001',
        classId: CLASS_ID,
        gradeId: 'grade-001',
      });

      const url = `/attendance/roster?classId=${CLASS_ID}&academicPeriodId=${PERIOD_ID}&date=2024-06-15`;
      const response = await app.inject({
        method: 'GET',
        url,
      });

      expect(response.statusCode).toBe(200);
      const body = JSON.parse(response.body);
      expect(body.data).toHaveLength(1);
      expect(body.data[0].studentId).toBe(STUDENT_ID);
    });

    it('should return 400 for missing query params', async () => {
      const response = await app.inject({
        method: 'GET',
        url: '/attendance/roster',
      });

      expect(response.statusCode).toBe(400);
    });
  });

  describe('GET /attendance/config/:institutionId', () => {
    it('should return default config when none exists', async () => {
      const response = await app.inject({
        method: 'GET',
        url: `/attendance/config/${INSTITUTION_ID}`,
      });

      expect(response.statusCode).toBe(200);
      const body = JSON.parse(response.body);
      expect(body.recordingMode).toBe('class');
      expect(body.leaveTypes).toHaveLength(0);
    });

    it('should return configured config', async () => {
      repository.addInstitutionConfig({
        institutionId: INSTITUTION_ID,
        tenantId: TENANT_ID,
        recordingMode: 'subject',
        leaveTypes: [
          { id: 'lt-001', name: 'Sick Leave', code: 'SICK', isActive: true },
        ],
      });

      const response = await app.inject({
        method: 'GET',
        url: `/attendance/config/${INSTITUTION_ID}`,
      });

      expect(response.statusCode).toBe(200);
      const body = JSON.parse(response.body);
      expect(body.recordingMode).toBe('subject');
      expect(body.leaveTypes).toHaveLength(1);
    });
  });
});
