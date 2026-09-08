import type { FastifyInstance } from 'fastify';
import fp from 'fastify-plugin';

import type { CommunicationRepository } from './communication-repository.js';
import { CommunicationService, type CommunicationAuditSink } from './communication-service.js';
import type { CommunicationDeliveryAdapter } from './delivery-adapter.js';
import { registerCommunicationRoutes } from './routes.js';

export interface CommunicationPluginOptions {
  repository: CommunicationRepository;
  deliveryAdapter?: CommunicationDeliveryAdapter;
  auditSink?: CommunicationAuditSink | null;
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
    const { repository, deliveryAdapter, auditSink = null, prefix = '/communication' } = options;
    const communicationService = new CommunicationService(repository, {
      deliveryAdapter,
      auditSink,
    });
    fastify.decorate('communicationService', communicationService);
    await registerCommunicationRoutes(fastify, { communicationService, prefix });
  },
  {
    name: '@proctira/backend-communication',
    fastify: '4.x',
    dependencies: [],
  },
);
