import type { FastifyInstance } from 'fastify';
import fp from 'fastify-plugin';

import type { FeesLedgerPort } from './fees-ledger-port.js';
import { createIsbnLookup, type IsbnLookup } from './isbn-lookup.js';
import type { LibraryRepository } from './library-repository.js';
import { LibraryService } from './library-service.js';
import { registerLibraryRoutes, type PatronBinding } from './routes.js';

export interface LibraryPluginOptions {
  repository: LibraryRepository;
  /** Optional fees ledger for fine posting (G-603). */
  feesLedger?: FeesLedgerPort | null;
  isbnLookup?: IsbnLookup;
  prefix?: string;
  /** Parent/guardian → child linkage for portal reads of loans/holds (G-916). */
  patronBinding?: PatronBinding | null;
}

declare module 'fastify' {
  interface FastifyInstance {
    libraryService: LibraryService;
  }
}

export const libraryPlugin = fp(
  async function libraryPluginImpl(fastify: FastifyInstance, options: LibraryPluginOptions) {
    const {
      repository,
      feesLedger = null,
      isbnLookup = createIsbnLookup(),
      prefix = '/library',
      patronBinding = null,
    } = options;
    const libraryService = new LibraryService(repository, feesLedger, isbnLookup);
    fastify.decorate('libraryService', libraryService);
    await registerLibraryRoutes(fastify, { libraryService, prefix, patronBinding });
  },
  {
    name: '@proctira/backend-library',
    fastify: '5.x',
    dependencies: [],
  },
);
