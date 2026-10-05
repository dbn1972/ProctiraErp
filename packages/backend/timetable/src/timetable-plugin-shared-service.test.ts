/**
 * PRC-L320 + PRC-M101: a shared (pre-built) TimetableService must carry its own
 * construction options. Passing staffBelongsToInstitution/timeZone next to
 * options.service would be silently ignored, so the plugin refuses it.
 */
import Fastify from 'fastify';
import { describe, expect, it } from 'vitest';
import { InMemoryTimetableOpsStore } from './generation-store.js';
import { InMemoryTimetableRepository } from './in-memory-repository.js';
import { timetablePlugin } from './timetable-plugin.js';
import { TimetableService } from './timetable-service.js';

describe('timetablePlugin with a shared service', () => {
  it('uses the shared instance as fastify.timetableService', async () => {
    const repository = new InMemoryTimetableRepository();
    const service = new TimetableService(repository, new InMemoryTimetableOpsStore());
    const app = Fastify({ logger: false });
    await app.register(timetablePlugin, { repository, service, prefix: '/timetable' });
    await app.ready();
    expect(app.timetableService).toBe(service);
    await app.close();
  });

  it.each([
    ['staffBelongsToInstitution', { staffBelongsToInstitution: async () => true }],
    ['timeZone', { timeZone: 'Asia/Kolkata' }],
  ])('refuses %s alongside options.service (would be dropped)', async (_name, extra) => {
    const repository = new InMemoryTimetableRepository();
    const service = new TimetableService(repository, new InMemoryTimetableOpsStore());
    const app = Fastify({ logger: false });
    await expect(
      app
        .register(timetablePlugin, { repository, service, prefix: '/timetable', ...extra })
        .ready(),
    ).rejects.toThrow(/shared TimetableService/);
    await app.close();
  });
});
