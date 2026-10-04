/**
 * PRC-L320: institution rollover reuses the SAME Timetable/LMS service
 * instances that the timetable/LMS domain plugins mount (no private copies).
 */
import { lmsPlugin } from '@proctira/backend-lms';
import { timetablePlugin } from '@proctira/backend-timetable';
import Fastify from 'fastify';
import { describe, expect, it } from 'vitest';

import {
  sharedLmsService,
  sharedTimetableService,
  type DomainPluginDependencies,
} from './domain-plugins.js';

function deps(): DomainPluginDependencies {
  return { publicTenantResolver: {} as DomainPluginDependencies['publicTenantResolver'] };
}

describe('PRC-L320 shared rollover services', () => {
  it('returns one instance per gateway app and distinct instances across apps', () => {
    const a = deps();
    const b = deps();
    expect(sharedTimetableService(a).service).toBe(sharedTimetableService(a).service);
    expect(sharedLmsService(a).service).toBe(sharedLmsService(a).service);
    expect(sharedTimetableService(a).service).not.toBe(sharedTimetableService(b).service);
    expect(sharedLmsService(a).service).not.toBe(sharedLmsService(b).service);
  });

  it('the mounted plugins decorate the shared instance the rollover hooks use', async () => {
    const d = deps();
    const app = Fastify();
    const tt = sharedTimetableService(d);
    const lms = sharedLmsService(d);
    await app.register(timetablePlugin, { repository: tt.repository, service: tt.service });
    await app.register(lmsPlugin, { repository: lms.repository, service: lms.service });
    await app.ready();
    expect(app.timetableService).toBe(tt.service);
    expect(app.lmsService).toBe(lms.service);
    await app.close();
  });
});
