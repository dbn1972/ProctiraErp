import type { FastifyInstance } from 'fastify';
import fp from 'fastify-plugin';

import { registerTimetableRoutes } from './routes.js';
import type { TimetableRepository } from './timetable-repository.js';
import { TimetableService } from './timetable-service.js';

export interface TimetablePluginOptions {
  repository: TimetableRepository;
  prefix?: string;
}

declare module 'fastify' {
  interface FastifyInstance {
    timetableService: TimetableService;
  }
}

export const timetablePlugin = fp(
  async function timetablePluginImpl(fastify: FastifyInstance, options: TimetablePluginOptions) {
    const service = new TimetableService(options.repository);
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
