import type { FastifyInstance } from 'fastify';
import fp from 'fastify-plugin';
import type { AlumniRepository } from './alumni-repository.js';
import { AlumniService } from './alumni-service.js';
import { registerAlumniRoutes } from './routes.js';

export interface AlumniPluginOptions {
  repository: AlumniRepository;
  prefix?: string;
}

export const alumniPlugin = fp(
  async function alumniPluginImpl(
    fastify: FastifyInstance,
    options: AlumniPluginOptions,
  ) {
    const service = new AlumniService(options.repository);
    await registerAlumniRoutes(fastify, {
      service,
      prefix: options.prefix ?? '/alumni',
    });
  },
  { name: '@proctira/backend-alumni', fastify: '4.x' },
);
