/** PRC-M406: rosters, generation jobs and absences are staff-only reads. */
import Fastify, { type FastifyInstance, type FastifyRequest } from 'fastify';
import { afterEach, describe, expect, it } from 'vitest';
import { InMemoryTimetableRepository } from './in-memory-repository.js';
import { timetablePlugin } from './timetable-plugin.js';

const TENANT = '11111111-1111-4111-8111-111111111111';
const INST = '22222222-2222-4222-8222-222222222222';
const TERM = '33333333-3333-4333-8333-333333333333';
const STAFF = '55555555-5555-4555-8555-555555555555';
const STUDENT = 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa';

let app: FastifyInstance;
afterEach(async () => {
  await app.close();
});

async function build() {
  app = Fastify({ logger: false });
  app.addHook('onRequest', async (request) => {
    (request as FastifyRequest & { tenantId?: string }).tenantId = TENANT;
    const role = String(request.headers['x-test-role'] ?? 'admin');
    (request as FastifyRequest & { user: { id: string; roles: string[] } }).user = {
      id: 'u',
      roles: [role],
    };
  });
  await app.register(timetablePlugin, {
    repository: new InMemoryTimetableRepository(),
    prefix: '/timetable',
  });
  const sec = await app.inject({
    method: 'POST',
    url: '/timetable/sections',
    payload: { institutionId: INST, academicPeriodId: TERM, name: '5A' },
  });
  const sectionId = sec.json().id as string;
  await app.inject({
    method: 'POST',
    url: `/timetable/sections/${sectionId}/enrollments`,
    payload: { studentId: STUDENT },
  });
  return sectionId;
}

describe('timetable read access (PRC-M406)', () => {
  it.each(['student', 'parent', 'guardian'])(
    '%s gets 403 on rosters, generation jobs and absences',
    async (role) => {
      const sectionId = await build();
      const headers = { 'x-test-role': role };
      for (const url of [
        `/timetable/sections/${sectionId}/enrollments`,
        '/timetable/generation-jobs',
        `/timetable/generation-jobs/${STAFF}`,
        `/timetable/teacher-absences/affected?institutionId=${INST}&staffId=${STAFF}&date=2026-09-07`,
      ]) {
        const res = await app.inject({ method: 'GET', url, headers });
        expect(res.statusCode, url).toBe(403);
      }
    },
  );

  it('GET /sections/:id strips the roster for non-staff and keeps it for teachers', async () => {
    const sectionId = await build();
    const student = await app.inject({
      method: 'GET',
      url: `/timetable/sections/${sectionId}`,
      headers: { 'x-test-role': 'student' },
    });
    expect(student.statusCode).toBe(200);
    expect(student.json()).not.toHaveProperty('enrollments');
    expect(JSON.stringify(student.json())).not.toContain(STUDENT);
    const teacher = await app.inject({
      method: 'GET',
      url: `/timetable/sections/${sectionId}`,
      headers: { 'x-test-role': 'teacher' },
    });
    expect(teacher.json().enrollments).toHaveLength(1);
  });

  it('teacher can read the roster; student cannot clone a period', async () => {
    const sectionId = await build();
    const roster = await app.inject({
      method: 'GET',
      url: `/timetable/sections/${sectionId}/enrollments`,
      headers: { 'x-test-role': 'teacher' },
    });
    expect(roster.statusCode).toBe(200);
    const clone = await app.inject({
      method: 'POST',
      url: '/timetable/clone-period',
      headers: { 'x-test-role': 'student' },
      payload: { sourcePeriodId: TERM, targetPeriodId: INST },
    });
    expect(clone.statusCode).toBe(403);
  });
});
