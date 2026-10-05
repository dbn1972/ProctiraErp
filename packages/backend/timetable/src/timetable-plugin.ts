import type { FastifyInstance } from 'fastify';
import fp from 'fastify-plugin';

import type { TimetableOpsStore } from './generation-store.js';
import { createTimetableOpsStore } from './repository-factory.js';
import { registerTimetableRoutes } from './routes.js';
import type { TimetableRepository } from './timetable-repository.js';
import { TimetableService, type TimetableServiceOptions } from './timetable-service.js';

export interface TimetablePluginOptions {
  repository: TimetableRepository;
  opsStore?: TimetableOpsStore;
  /** PRC-M403: institution/tenant timezone for enrollment dates (default UTC). */
  timeZone?: TimetableServiceOptions['timeZone'];
  prefix?: string;
}

declare module 'fastify' {
  interface FastifyInstance {
    timetableService: TimetableService;
  }
}

export const timetablePlugin = fp(
  async function timetablePluginImpl(fastify: FastifyInstance, options: TimetablePluginOptions) {
    const service = new TimetableService(
      options.repository,
      options.opsStore ?? createTimetableOpsStore(),
      { timeZone: options.timeZone },
    );
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
