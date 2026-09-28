import Fastify from 'fastify';
import { describe, expect, it } from 'vitest';

import {
  InMemoryTimetableRepository,
  TimetableService,
  timetablePlugin,
} from '@proctira/backend-timetable';

const tenantA = '11111111-1111-4111-8111-111111111111';
const tenantB = '99999999-9999-4999-8999-999999999999';
const institutionId = '22222222-2222-4222-8222-222222222222';
const academicPeriodId = '33333333-3333-4333-8333-333333333333';
const studentA = 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa';

/**
 * Gateway mount of DELETE /api/v1/timetable/sections/:id/enrollments/:studentId.
 * Tenant comes from the verified user, the same source the gateway auth plugin sets.
 */
describe('gateway timetable withdraw IDOR', () => {
  it('returns 404 for a cross-tenant section and for a student who is not enrolled', async () => {
    const repository = new InMemoryTimetableRepository();
    const service = new TimetableService(repository);
    const section = await service.createSection(tenantA, {
      institutionId,
      academicPeriodId,
      name: 'Class 9-B Mathematics',
      code: 'G9B-MATH',
      capacity: 40,
    });
    await service.enrollStudent(tenantA, section.id, studentA);

    const app = Fastify();
    app.addHook('onRequest', async (request) => {
      const scoped = request as {
        tenantId?: string;
        user?: { tenantId: string; roles: { roleId: string; roleName: string }[] };
      };
      scoped.tenantId = tenantB;
      scoped.user = {
        tenantId: tenantB,
        roles: [{ roleId: 'principal', roleName: 'Principal' }],
      };
    });
    await app.register(timetablePlugin, {
      repository,
      prefix: '/api/v1/timetable',
    });
    await app.ready();

    const crossSection = await app.inject({
      method: 'DELETE',
      url: `/api/v1/timetable/sections/${section.id}/enrollments/${studentA}`,
      headers: { 'x-tenant-id': tenantA },
    });
    expect(crossSection.statusCode).toBe(404);

    const crossStudent = await app.inject({
      method: 'DELETE',
      url: `/api/v1/timetable/sections/${section.id}/enrollments/bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb`,
      headers: { 'x-tenant-id': tenantA },
    });
    expect(crossStudent.statusCode).toBe(404);

    const stillEnrolled = await service.listEnrollments(tenantA, section.id);
    expect(stillEnrolled.some((row) => row.studentId === studentA && row.status === 'ENROLLED')).toBe(
      true,
    );
    await app.close();
  });
});
