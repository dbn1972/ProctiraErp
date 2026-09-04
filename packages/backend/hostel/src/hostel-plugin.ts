import type { FastifyInstance } from 'fastify';
import fp from 'fastify-plugin';
import type { HostelRepository } from './hostel-repository.js';
import { HostelService } from './hostel-service.js';
import { registerHostelRoutes } from './routes.js';

export interface HostelPluginOptions {
  repository: HostelRepository;
  prefix?: string;
}

export const hostelPlugin = fp(
  async function hostelPluginImpl(
    fastify: FastifyInstance,
    options: HostelPluginOptions,
  ) {
    const service = new HostelService(options.repository);
    await registerHostelRoutes(fastify, {
      service,
      prefix: options.prefix ?? '/hostels',
    });
  },
  { name: '@proctira/backend-hostel', fastify: '4.x' },
);
