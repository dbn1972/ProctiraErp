import Fastify from 'fastify';
import { describe, expect, it } from 'vitest';

import { InMemoryTimetableRepository } from './in-memory-repository.js';
import { registerTimetableRoutes } from './routes.js';
import { TimetableService } from './timetable-service.js';

const tenantA = '11111111-1111-4111-8111-111111111111';
const tenantB = '99999999-9999-4999-8999-999999999999';
const institutionId = '22222222-2222-4222-8222-222222222222';
const academicPeriodId = '33333333-3333-4333-8333-333333333333';
const studentA = 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa';

/**
 * The gateway mounts these timetable routes. A principal in another tenant
 * must not withdraw a student from a section they cannot see.
 */
describe('DELETE /timetable/sections/:id/enrollments/:studentId', () => {
  it('returns 404 when the section enrollment belongs to another tenant', async () => {
    const service = new TimetableService(new InMemoryTimetableRepository());
    const section = await service.createSection(tenantA, {
      institutionId,
      academicPeriodId,
      name: 'Class 9-B Mathematics',
      code: 'G9B-MATH',
      capacity: 40,
    });
    await service.enrollStudent(tenantA, section.id, studentA);

    const app = Fastify();
    app.addHook('preHandler', async (request) => {
      (request as { user?: { tenantId: string; roles: string[] } }).user = {
        tenantId: tenantB,
        roles: ['principal'],
      };
    });
    await registerTimetableRoutes(app, { service });
    await app.ready();

    const crossSection = await app.inject({
      method: 'DELETE',
      url: `/timetable/sections/${section.id}/enrollments/${studentA}`,
    });
    expect(crossSection.statusCode).toBe(404);

    const crossStudent = await app.inject({
      method: 'DELETE',
      url: `/timetable/sections/${section.id}/enrollments/bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb`,
    });
    expect(crossStudent.statusCode).toBe(404);

    const stillEnrolled = await service.listEnrollments(tenantA, section.id);
    expect(stillEnrolled.some((row) => row.studentId === studentA && row.status === 'ENROLLED')).toBe(
      true,
    );
    await app.close();
  });
});
