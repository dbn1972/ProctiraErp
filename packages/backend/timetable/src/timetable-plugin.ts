import type { FastifyInstance } from 'fastify';
import fp from 'fastify-plugin';

import type { TimetableOpsStore } from './generation-store.js';
import { createTimetableOpsStore } from './repository-factory.js';
import { registerTimetableRoutes } from './routes.js';
import type { TimetableRepository } from './timetable-repository.js';
import { TimetableService } from './timetable-service.js';

export interface TimetablePluginOptions {
  repository: TimetableRepository;
  opsStore?: TimetableOpsStore;
  prefix?: string;
  /**
   * PRC-L320: pre-built service instance shared with other in-process callers
   * (e.g. institution rollover) so they use the mounted instance, not a copy.
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
    const service =
      options.service ??
      new TimetableService(options.repository, options.opsStore ?? createTimetableOpsStore());
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
