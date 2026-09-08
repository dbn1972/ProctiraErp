import type { FastifyInstance } from 'fastify';
import fp from 'fastify-plugin';

import type { FeesLedgerPort } from './fees-ledger-port.js';
import type { LibraryRepository } from './library-repository.js';
import { LibraryService } from './library-service.js';
import { registerLibraryRoutes } from './routes.js';

export interface LibraryPluginOptions {
  repository: LibraryRepository;
  /** Optional fees ledger for fine posting (G-603). */
  feesLedger?: FeesLedgerPort | null;
  prefix?: string;
}

declare module 'fastify' {
  interface FastifyInstance {
    libraryService: LibraryService;
  }
}

export const libraryPlugin = fp(
  async function libraryPluginImpl(fastify: FastifyInstance, options: LibraryPluginOptions) {
    const { repository, feesLedger = null, prefix = '/library' } = options;
    const libraryService = new LibraryService(repository, feesLedger);
    fastify.decorate('libraryService', libraryService);
    await registerLibraryRoutes(fastify, { libraryService, prefix });
  },
  {
    name: '@proctira/backend-library',
    fastify: '5.x',
    dependencies: [],
  },
);
