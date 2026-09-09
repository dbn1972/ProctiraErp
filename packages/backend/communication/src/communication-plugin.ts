import type { FastifyInstance } from 'fastify';
import fp from 'fastify-plugin';

import type { CircularStore } from './circular-store.js';
import { registerCircularRoutes } from './circulars-routes.js';
import { CircularsService } from './circulars-service.js';
import type { CommunicationRepository } from './communication-repository.js';
import { CommunicationService, type CommunicationAuditSink } from './communication-service.js';
import { createCircularStore } from './create-circular-store.js';
import type { CommunicationDeliveryAdapter } from './delivery-adapter.js';
import { registerCommunicationRoutes } from './routes.js';
import { createSandboxWhatsAppAdapter, type WhatsAppChannelAdapter } from './whatsapp-adapter.js';

export interface CommunicationPluginOptions {
  repository: CommunicationRepository;
  deliveryAdapter?: CommunicationDeliveryAdapter;
  auditSink?: CommunicationAuditSink | null;
  circularStore?: CircularStore;
  whatsappAdapter?: WhatsAppChannelAdapter;
  prefix?: string;
}

declare module 'fastify' {
  interface FastifyInstance {
    communicationService: CommunicationService;
    circularsService?: CircularsService;
  }
}

export const communicationPlugin = fp(
  async function communicationPluginImpl(
    fastify: FastifyInstance,
    options: CommunicationPluginOptions,
  ) {
    const { repository, deliveryAdapter, auditSink = null, prefix = '/communication' } = options;
    const circularStore = options.circularStore ?? createCircularStore();
    const circularsService = new CircularsService(circularStore, {
      whatsappAdapter: options.whatsappAdapter ?? createSandboxWhatsAppAdapter(),
    });
    const communicationService = new CommunicationService(repository, {
      deliveryAdapter,
      auditSink,
      deliveryLogSink: (event) =>
        circularsService.appendSourceDelivery(event.tenantId, {
          channels: event.channels,
          sourceType: event.sourceType,
          sourceId: event.sourceId,
          title: event.title,
          body: event.body,
        }),
    });
    fastify.decorate('communicationService', communicationService);
    fastify.decorate('circularsService', circularsService);
    await registerCommunicationRoutes(fastify, { communicationService, prefix });
    await registerCircularRoutes(fastify, { circularsService, prefix });
  },
  {
    name: '@proctira/backend-communication',
    fastify: '5.x',
    dependencies: [],
  },
);
