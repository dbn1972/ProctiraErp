import type { FastifyInstance } from 'fastify';
import fp from 'fastify-plugin';

import type { CommunicationRepository } from './communication-repository.js';
import { CommunicationService } from './communication-service.js';
import { registerCommunicationRoutes } from './routes.js';

export interface CommunicationPluginOptions {
  repository: CommunicationRepository;
  prefix?: string;
}

declare module 'fastify' {
  interface FastifyInstance {
    communicationService: CommunicationService;
  }
}

export const communicationPlugin = fp(
  async function communicationPluginImpl(
    fastify: FastifyInstance,
    options: CommunicationPluginOptions,
  ) {
    const { repository, prefix = '/communication' } = options;
    const communicationService = new CommunicationService(repository);
    fastify.decorate('communicationService', communicationService);
    await registerCommunicationRoutes(fastify, { communicationService, prefix });
  },
  {
    name: '@proctira/backend-communication',
    fastify: '4.x',
    dependencies: [],
  },
);
