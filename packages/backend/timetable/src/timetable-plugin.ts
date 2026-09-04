import type { FastifyInstance } from 'fastify';
import fp from 'fastify-plugin';
import type { TimetableRepository } from './timetable-repository.js';
import { TimetableService } from './timetable-service.js';
import { registerTimetableRoutes } from './routes.js';

export interface TimetablePluginOptions {
  repository: TimetableRepository;
  prefix?: string;
}

export const timetablePlugin = fp(
  async function timetablePluginImpl(
    fastify: FastifyInstance,
    options: TimetablePluginOptions,
  ) {
    const service = new TimetableService(options.repository);
    await registerTimetableRoutes(fastify, {
      service,
      prefix: options.prefix ?? '/timetables',
    });
  },
  { name: '@proctira/backend-timetable', fastify: '4.x' },
);
