import type { FastifyInstance } from 'fastify';
import fp from 'fastify-plugin';

import type { CircularStore } from './circular-store.js';
import { registerCircularRoutes, type CircularRecipientBinding } from './circulars-routes.js';
import { CircularsService, type CircularAuditSink } from './circulars-service.js';
import type { CommunicationRepository } from './communication-repository.js';
import { CommunicationService, type CommunicationAuditSink } from './communication-service.js';
import { createCircularStore } from './create-circular-store.js';
import type { CommunicationDeliveryAdapter } from './delivery-adapter.js';
import { registerCommunicationRoutes } from './routes.js';
import { createWhatsAppAdapter, type WhatsAppChannelAdapter } from './whatsapp-adapter.js';

export interface CommunicationPluginOptions {
  repository: CommunicationRepository;
  deliveryAdapter?: CommunicationDeliveryAdapter;
  auditSink?: CommunicationAuditSink | null;
  circularStore?: CircularStore;
  whatsappAdapter?: WhatsAppChannelAdapter;
  prefix?: string;
  /** PRC-M188: guardian → linked-student ids allowed for circular acks. */
  recipientBinding?: CircularRecipientBinding;
  /** Durable audit for admin-recorded (on-behalf) circular acknowledgements. */
  circularAuditSink?: CircularAuditSink | null;
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
      // W1-ARCH-08: policy factory — not raw createSandboxWhatsAppAdapter().
      whatsappAdapter: options.whatsappAdapter ?? createWhatsAppAdapter(),
      auditSink: options.circularAuditSink ?? null,
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
    await registerCircularRoutes(fastify, {
      circularsService,
      prefix,
      recipientBinding: options.recipientBinding,
    });
  },
  {
    name: '@proctira/backend-communication',
    fastify: '5.x',
    dependencies: [],
  },
);
