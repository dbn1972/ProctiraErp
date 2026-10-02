/**
 * PRC-H022: section-addressed writes (PUT/DELETE /sections/:id) must name the owning institution
 * and the section must belong to it; a foreign id is a 404, never an update of another school.
 */
import Fastify, { type FastifyInstance, type FastifyRequest } from 'fastify';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { InMemoryTimetableRepository } from './in-memory-repository.js';
import { timetablePlugin } from './timetable-plugin.js';

const TENANT = '11111111-1111-4111-8111-111111111111';
const SCHOOL_A = '22222222-2222-4222-8222-222222222222';
const SCHOOL_B = '33333333-3333-4333-8333-333333333333';
const PERIOD = '44444444-4444-4444-8444-444444444444';

describe('PRC-H022 timetable section institution ownership', () => {
  let app: FastifyInstance;
  let sectionId: string;

  beforeEach(async () => {
    app = Fastify({ logger: false });
    app.addHook('onRequest', async (request) => {
      (request as FastifyRequest & { tenantId?: string }).tenantId = TENANT;
      (request as FastifyRequest & { user: { id: string; roles: string[] } }).user = {
        id: 'actor-1',
        roles: ['admin'],
      };
    });
    await app.register(timetablePlugin, {
      repository: new InMemoryTimetableRepository(),
      prefix: '/timetable',
    });
    await app.ready();
    const created = await app.inject({
      method: 'POST',
      url: '/timetable/sections',
      payload: { institutionId: SCHOOL_A, academicPeriodId: PERIOD, name: '7-A', code: '7A' },
    });
    expect(created.statusCode).toBe(201);
    sectionId = (created.json() as { id: string }).id;
  });

  afterEach(async () => {
    await app.close();
  });

  it('PUT and DELETE without institutionId are rejected (400)', async () => {
    const put = await app.inject({
      method: 'PUT',
      url: `/timetable/sections/${sectionId}`,
      payload: { name: '7-B' },
    });
    expect(put.statusCode).toBe(400);
    expect(put.json()).toMatchObject({ code: 'INSTITUTION_REQUIRED' });
    const del = await app.inject({ method: 'DELETE', url: `/timetable/sections/${sectionId}` });
    expect(del.statusCode).toBe(400);
  });

  it('PUT and DELETE naming another institution 404 and leave the section intact', async () => {
    const put = await app.inject({
      method: 'PUT',
      url: `/timetable/sections/${sectionId}?institutionId=${SCHOOL_B}`,
      payload: { name: 'Hijacked' },
    });
    expect(put.statusCode).toBe(404);
    const del = await app.inject({
      method: 'DELETE',
      url: `/timetable/sections/${sectionId}?institutionId=${SCHOOL_B}`,
    });
    expect(del.statusCode).toBe(404);
    const read = await app.inject({ method: 'GET', url: `/timetable/sections/${sectionId}` });
    expect(read.statusCode).toBe(200);
    expect(read.json()).toMatchObject({ name: '7-A' });
  });

  it('PUT and DELETE naming the owning institution succeed', async () => {
    const put = await app.inject({
      method: 'PUT',
      url: `/timetable/sections/${sectionId}?institutionId=${SCHOOL_A}`,
      payload: { name: '7-B' },
    });
    expect(put.statusCode).toBe(200);
    expect(put.json()).toMatchObject({ name: '7-B' });
    const del = await app.inject({
      method: 'DELETE',
      url: `/timetable/sections/${sectionId}?institutionId=${SCHOOL_A}`,
    });
    expect(del.statusCode).toBe(204);
  });
});
