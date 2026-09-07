import type { FastifyInstance } from 'fastify';
import fp from 'fastify-plugin';

import type { LibraryRepository } from './library-repository.js';
import { LibraryService } from './library-service.js';
import { registerLibraryRoutes } from './routes.js';

export interface LibraryPluginOptions {
  repository: LibraryRepository;
  prefix?: string;
}

declare module 'fastify' {
  interface FastifyInstance {
    libraryService: LibraryService;
  }
}

export const libraryPlugin = fp(
  async function libraryPluginImpl(fastify: FastifyInstance, options: LibraryPluginOptions) {
    const { repository, prefix = '/library' } = options;
    const libraryService = new LibraryService(repository);
    fastify.decorate('libraryService', libraryService);
    await registerLibraryRoutes(fastify, { libraryService, prefix });
  },
  {
    name: '@proctira/backend-library',
    fastify: '4.x',
    dependencies: [],
  },
);
