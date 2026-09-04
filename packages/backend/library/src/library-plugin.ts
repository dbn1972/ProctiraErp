import type { FastifyInstance } from 'fastify';
import fp from 'fastify-plugin';
import type { LibraryRepository } from './library-repository.js';
import { LibraryService } from './library-service.js';
import { registerLibraryRoutes } from './routes.js';

export interface LibraryPluginOptions {
  repository: LibraryRepository;
  prefix?: string;
}

export const libraryPlugin = fp(
  async function libraryPluginImpl(
    fastify: FastifyInstance,
    options: LibraryPluginOptions,
  ) {
    const service = new LibraryService(options.repository);
    await registerLibraryRoutes(fastify, {
      service,
      prefix: options.prefix ?? '/library',
    });
  },
  { name: '@proctira/backend-library', fastify: '4.x' },
);
