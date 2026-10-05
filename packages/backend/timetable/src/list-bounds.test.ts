/** PRC-M407: list endpoints are bounded; clash scans fetch only candidate-relevant rows. */
import Fastify, { type FastifyRequest } from 'fastify';
import { describe, expect, it } from 'vitest';
import { InMemoryTimetableRepository } from './in-memory-repository.js';
import type { ListMeetingsFilter } from './timetable-repository.js';
import { timetablePlugin } from './timetable-plugin.js';
import { TimetableService } from './timetable-service.js';

const TENANT = '11111111-1111-4111-8111-111111111111';
const INST = '22222222-2222-4222-8222-222222222222';
const TERM = '33333333-3333-4333-8333-333333333333';

describe('bounded lists (PRC-M407)', () => {
  it('sections list honours limit/offset and caps the page', async () => {
    const repo = new InMemoryTimetableRepository();
    const service = new TimetableService(repo);
    for (let i = 0; i < 120; i += 1) {
      await service.createSection(TENANT, {
        institutionId: INST,
        academicPeriodId: TERM,
        name: `S${String(i).padStart(3, '0')}`,
      });
    }
    const app = Fastify({ logger: false });
    app.addHook('onRequest', async (request) => {
      (request as FastifyRequest & { tenantId?: string }).tenantId = TENANT;
      (request as FastifyRequest & { user: { id: string; roles: string[] } }).user = {
        id: 'a',
        roles: ['admin'],
      };
    });
    await app.register(timetablePlugin, { repository: repo, prefix: '/timetable' });
    const first = await app.inject({ method: 'GET', url: '/timetable/sections?limit=10' });
    expect(first.json().data).toHaveLength(10);
    const second = await app.inject({
      method: 'GET',
      url: '/timetable/sections?limit=10&offset=10',
    });
    expect(second.json().data[0].id).not.toBe(first.json().data[0].id);
    const dflt = await app.inject({ method: 'GET', url: '/timetable/sections' });
    expect(dflt.json().data).toHaveLength(100);
    const bad = await app.inject({ method: 'GET', url: '/timetable/meetings?limit=0' });
    expect(bad.statusCode).toBe(400);
    const badStatus = await app.inject({
      method: 'GET',
      url: '/timetable/substitutions?status=bogus',
    });
    expect(badStatus.statusCode).toBe(400);
    await app.close();
  });

  it('meeting clash check queries by academic period and weekday', async () => {
    const repo = new InMemoryTimetableRepository();
    const service = new TimetableService(repo);
    const filters: Array<ListMeetingsFilter | undefined> = [];
    const original = repo.listMeetings.bind(repo);
    repo.listMeetings = async (t, f) => {
      filters.push(f);
      return original(t, f);
    };
    await service.createMeeting(TENANT, {
      institutionId: INST,
      academicPeriodId: TERM,
      sectionId: '77777777-7777-4777-8777-777777777777',
      subjectId: null,
      staffId: '55555555-5555-4555-8555-555555555555',
      periodId: '99999999-9999-4999-8999-999999999999',
      roomId: null,
      dayOfWeek: 3,
      status: 'active',
    });
    expect(filters).toContainEqual({ institutionId: INST, academicPeriodId: TERM, dayOfWeek: 3 });
  });
});
