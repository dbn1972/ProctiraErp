/**
 * PRC-M148: `GET /students` honours the `gradeId` and `status` filters the web
 * student list sends. Before the fix the route dropped both, so every tab and
 * grade selection returned the unfiltered page.
 */
import Fastify, { type FastifyInstance } from 'fastify';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';

import { InMemoryStudentRepository } from './in-memory-repository.js';
import { registerStudentRoutes } from './routes.js';
import { StudentService } from './student-service.js';

const TENANT_ID = '6f0b6c1e-3b7a-4c55-9d1e-2a4f8b9c0d11';
const GRADE_5 = '22222222-2222-4222-8222-222222222222';
const GRADE_6 = '33333333-3333-4333-8333-333333333333';

describe('GET /students enrollment filters (PRC-M148)', () => {
  let app: FastifyInstance;

  beforeEach(async () => {
    app = Fastify();
    const service = new StudentService(new InMemoryStudentRepository());
    app.decorateRequest('tenantId', '');
    app.addHook('onRequest', async (request) => {
      (request as unknown as { tenantId: string }).tenantId = TENANT_ID;
      (request as unknown as { user: { roles: string[] } }).user = { roles: ['registrar'] };
    });
    await registerStudentRoutes(app, { studentService: service });
    await app.ready();
    const rows: Array<[string, Record<string, unknown>]> = [
      ['Asha', { gradeId: GRADE_5 }],
      ['Bina', { gradeId: GRADE_6 }],
      ['Chitra', { gradeId: GRADE_5, enrollmentStatus: 'WITHDRAWN' }],
    ];
    for (const [firstName, customData] of rows) {
      const res = await app.inject({
        method: 'POST',
        url: '/students',
        payload: {
          firstName,
          lastName: 'Rao',
          dateOfBirth: '2014-04-18',
          gender: 'female',
          customData,
        },
      });
      expect(res.statusCode).toBe(201);
    }
  });

  afterEach(async () => {
    await app.close();
  });

  const names = async (url: string) => {
    const res = await app.inject({ method: 'GET', url });
    expect(res.statusCode).toBe(200);
    return (res.json().data as Array<{ firstName: string }>).map((s) => s.firstName).sort();
  };

  it('gradeId returns only students enrolled in that grade', async () => {
    expect(await names(`/students?gradeId=${GRADE_5}`)).toEqual(['Asha']);
    expect(await names(`/students?gradeId=${GRADE_6}`)).toEqual(['Bina']);
  });

  it('status returns only students with an enrollment in that status', async () => {
    expect(await names('/students?status=WITHDRAWN')).toEqual(['Chitra']);
    expect(await names(`/students?status=WITHDRAWN&gradeId=${GRADE_5}`)).toEqual(['Chitra']);
    expect(await names(`/students?status=ENROLLED&gradeId=${GRADE_5}`)).toEqual(['Asha']);
  });

  it('no enrollment filter keeps the unfiltered list', async () => {
    expect(await names('/students')).toEqual(['Asha', 'Bina', 'Chitra']);
  });

  it('rejects an unknown status or a non-UUID gradeId with 400', async () => {
    for (const url of ['/students?status=EXPELLED', '/students?gradeId=grade-5']) {
      const res = await app.inject({ method: 'GET', url });
      expect(res.statusCode).toBe(400);
      expect(res.json().code).toBe('VALIDATION_ERROR');
    }
  });
});
