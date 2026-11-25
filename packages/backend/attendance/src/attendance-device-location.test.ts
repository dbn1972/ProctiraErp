/**
 * PRC-M468 / DR45: attendance stores no device location. A mark that carries
 * latitude/longitude (single, bulk record or staff) is refused with 400 and
 * nothing is written; the same mark without location is recorded.
 */
import Fastify, { type FastifyInstance } from 'fastify';
import { beforeEach, describe, expect, it } from 'vitest';
import { AttendanceService } from './attendance-service.js';
import { InMemoryAttendanceRepository } from './in-memory-repository.js';
import { registerAttendanceRoutes } from './routes.js';

const TENANT_ID = 'tenant-m468';
const INSTITUTION_ID = '11111111-1111-4111-8111-111111111111';
const CLASS_ID = '22222222-2222-4222-8222-222222222222';
const STUDENT_ID = '33333333-3333-4333-8333-333333333333';
const STAFF_ID = '44444444-4444-4444-8444-444444444444';
const PERIOD_ID = '55555555-5555-4555-8555-555555555555';

const mark = {
  studentId: STUDENT_ID,
  institutionId: INSTITUTION_ID,
  classId: CLASS_ID,
  academicPeriodId: PERIOD_ID,
  date: '2024-06-15',
  status: 'PRESENT',
};

describe('PRC-M468 attendance refuses device location (DR45)', () => {
  let app: FastifyInstance;
  let repository: InMemoryAttendanceRepository;

  beforeEach(async () => {
    repository = new InMemoryAttendanceRepository();
    repository.addAcademicPeriod({
      id: PERIOD_ID,
      tenantId: TENANT_ID,
      name: 'Academic Year 2024',
      startDate: new Date('2024-01-01'),
      endDate: new Date('2024-12-31'),
      status: 'active',
    });
    repository.addRosterEntry({
      studentId: STUDENT_ID,
      studentName: STUDENT_ID,
      enrollmentId: `enr-${STUDENT_ID}`,
      classId: CLASS_ID,
      gradeId: 'grade-001',
    });
    app = Fastify();
    app.decorateRequest('tenantId', '');
    app.decorateRequest('user', undefined);
    app.addHook('onRequest', async (request) => {
      Object.assign(request, {
        tenantId: TENANT_ID,
        user: { sub: 'teacher-1', roles: ['school_admin'] },
      });
    });
    await registerAttendanceRoutes(app, { attendanceService: new AttendanceService(repository) });
    await app.ready();
  });

  const post = (url: string, payload: Record<string, unknown>) =>
    app.inject({ method: 'POST', url, payload });

  it('single mark with latitude/longitude -> 400, nothing stored', async () => {
    const res = await post('/attendance/student', { ...mark, latitude: 12.97, longitude: 77.59 });
    expect(res.statusCode).toBe(400);
    expect(res.json().code).toBe('DEVICE_LOCATION_NOT_ACCEPTED');
    expect(repository.getStudentAttendanceRecords()).toHaveLength(0);
  });

  it('bulk record carrying a location -> 400 naming the record', async () => {
    const res = await post('/attendance/student/bulk', {
      institutionId: INSTITUTION_ID,
      classId: CLASS_ID,
      academicPeriodId: PERIOD_ID,
      date: '2024-06-15',
      records: [{ studentId: STUDENT_ID, status: 'PRESENT', lat: 1, lng: 2 }],
    });
    expect(res.statusCode).toBe(400);
    expect(res.json().errors[0].field).toBe('records[0].lat');
  });

  it('staff mark with a location -> 400', async () => {
    const res = await post('/attendance/staff', {
      staffId: STAFF_ID,
      institutionId: INSTITUTION_ID,
      date: '2024-06-15',
      status: 'PRESENT',
      location: { latitude: 1, longitude: 2 },
    });
    expect(res.statusCode).toBe(400);
    expect(res.json().code).toBe('DEVICE_LOCATION_NOT_ACCEPTED');
  });

  it('the same mark without location is recorded', async () => {
    const res = await post('/attendance/student', mark);
    expect(res.statusCode).toBe(201);
    expect(repository.getStudentAttendanceRecords()).toHaveLength(1);
  });
});
