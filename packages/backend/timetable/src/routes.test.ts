import Fastify, { type FastifyInstance, type FastifyRequest } from 'fastify';
import { afterEach, describe, expect, it } from 'vitest';

import { InMemoryTimetableRepository } from './in-memory-repository.js';
import { timetablePlugin } from './timetable-plugin.js';

const TENANT = '11111111-1111-4111-8111-111111111111';

describe('timetable routes SEC-2 tenant resolution', () => {
  let app: FastifyInstance;

  afterEach(async () => {
    await app.close();
  });

  it('rejects a request that only supplies x-tenant-id via header (no user.tenantId, no request.tenantId)', async () => {
    app = Fastify({ logger: false });
    // Deliberately do NOT set user.tenantId/request.tenantId, to simulate a
    // request that never went through a trusted tenant-resolution hook.
    app.addHook('onRequest', async (request) => {
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

    const response = await app.inject({
      method: 'GET',
      url: '/timetable/bell-schedules',
      headers: { 'x-tenant-id': TENANT },
    });

    // Must NOT resolve a tenant from the header and proceed (200); it must
    // fail the tenant-context check.
    expect(response.statusCode).toBe(401);
    expect(response.json()).toMatchObject({ code: 'UNAUTHORIZED' });
  });

  it('resolves normally when request.tenantId is set by a trusted hook (baseline sanity check)', async () => {
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

    const response = await app.inject({
      method: 'GET',
      url: '/timetable/bell-schedules',
    });

    expect(response.statusCode).toBe(200);
    expect(response.json()).toMatchObject({ data: [] });
  });
});
