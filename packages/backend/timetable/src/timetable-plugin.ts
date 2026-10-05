import type { FastifyInstance } from 'fastify';
import fp from 'fastify-plugin';

import type { TimetableOpsStore } from './generation-store.js';
import { createTimetableOpsStore } from './repository-factory.js';
import { registerTimetableRoutes } from './routes.js';
import type { TimetableRepository } from './timetable-repository.js';
import {
  TimetableService,
  type StaffInstitutionMembership,
  type TimetableServiceOptions,
} from './timetable-service.js';

export interface TimetablePluginOptions {
  repository: TimetableRepository;
  opsStore?: TimetableOpsStore;
  /** PRC-M403: institution/tenant timezone for enrollment dates (default UTC). */
  timeZone?: TimetableServiceOptions['timeZone'];
  prefix?: string;
  /** PRC-M101: when set, meetings/substitutions reject staff of another institution. */
  staffBelongsToInstitution?: StaffInstitutionMembership;
  /**
   * PRC-L320: pre-built service instance shared with other in-process callers
   * (e.g. institution rollover) so they use the mounted instance, not a copy.
   * Construction-time options (timeZone, staffBelongsToInstitution) must then be
   * given to that service, not here.
   */
  service?: TimetableService;
}

declare module 'fastify' {
  interface FastifyInstance {
    timetableService: TimetableService;
  }
}

export const timetablePlugin = fp(
  async function timetablePluginImpl(fastify: FastifyInstance, options: TimetablePluginOptions) {
    if (options.service && (options.staffBelongsToInstitution || options.timeZone)) {
      // Fail fast instead of silently dropping PRC-M101 / PRC-M403 wiring.
      throw new Error(
        'timetablePlugin: pass staffBelongsToInstitution/timeZone to the shared TimetableService, not alongside options.service',
      );
    }
    const service =
      options.service ??
      new TimetableService(options.repository, options.opsStore ?? createTimetableOpsStore(), {
        timeZone: options.timeZone,
        staffBelongsToInstitution: options.staffBelongsToInstitution,
      });
    fastify.decorate('timetableService', service);
    await registerTimetableRoutes(fastify, {
      service,
      prefix: options.prefix ?? '/timetable',
    });
  },
  {
    name: '@proctira/backend-timetable',
    fastify: '5.x',
    dependencies: [],
  },
);
