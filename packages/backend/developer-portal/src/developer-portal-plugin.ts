/**
 * Developer Portal Fastify Plugin
 *
 * Registers developer portal service routes and decorators on a Fastify instance.
 * Provides the developer portal service as a decorator for other plugins to use.
 */
import type { QueueAdapter } from '@proctira/queue-abstraction';
import type { FastifyInstance } from 'fastify';
import fp from 'fastify-plugin';

import type { DeveloperPortalExtendedRepository } from './developer-portal-repository.js';
import {
  DeveloperPortalService,
  type DeveloperPortalServiceConfig,
  type WebhookHttpFetch,
  type WebhookSigningSecretResolver,
  DEFAULT_CONFIG,
} from './developer-portal-service.js';
import type { WebhookDeliveryPublisher } from './queue-webhook-delivery-publisher.js';
import { registerDeveloperPortalRoutes } from './routes.js';
import {
  createWebhookDeliveryWorker,
  type WebhookDeliveryWorker,
} from './webhook-delivery-worker.js';
import {
  createWebhookEventFanOutSubscriber,
  type WebhookEventFanOutSubscriber,
} from './webhook-event-fanout.js';
import type { WebhookReplayStore } from './webhook-signature.js';

/**
 * Options for the developer portal plugin.
 */
export interface DeveloperPortalPluginOptions {
  /** Developer portal repository implementation */
  repository: DeveloperPortalExtendedRepository;
  /** Service configuration (optional, uses defaults) */
  config?: Partial<DeveloperPortalServiceConfig>;
  /** Durable webhook delivery publisher (W2-JOB-07) */
  deliveryPublisher?: WebhookDeliveryPublisher;
  /**
   * W1-SEC-08 replay store for inbound webhook signature verification.
   * Gateway should inject Redis-backed store in production via
   * {@link createWebhookReplayStoreFromEnv}.
   */
  replayStore?: WebhookReplayStore | null;
  /**
   * PRC-H046: dedicated queue adapter the in-process webhook delivery worker
   * consumes from (started onReady, stopped onClose).
   */
  deliveryWorkerQueue?: QueueAdapter;
  /** PRC-H046: domain event types fanned out to matching tenant webhooks. */
  fanOutEvents?: readonly string[];
  /** PRC-H046: adapter factory for fan-out subscriptions (one per event). */
  createFanOutQueue?: () => QueueAdapter;
  /** Outbound HTTP client override (tests). */
  httpFetch?: WebhookHttpFetch;
  /** PRC-H046: decrypted signing-secret resolver for queued deliveries. */
  signingSecretResolver?: WebhookSigningSecretResolver;
  /** Route prefix (default: '/developer') */
  prefix?: string;
}

// Extend Fastify types
declare module 'fastify' {
  interface FastifyInstance {
    developerPortalService: DeveloperPortalService;
    webhookDeliveryWorker?: WebhookDeliveryWorker;
    webhookFanOut?: WebhookEventFanOutSubscriber;
  }
}

/**
 * Fastify plugin that registers the developer portal service and routes.
 */
export const developerPortalPlugin = fp(
  async function developerPortalPluginImpl(
    fastify: FastifyInstance,
    options: DeveloperPortalPluginOptions,
  ) {
    const {
      repository,
      config = {},
      deliveryPublisher,
      replayStore,
      deliveryWorkerQueue,
      fanOutEvents = [],
      createFanOutQueue,
      httpFetch,
      signingSecretResolver,
      prefix = '/developer',
    } = options;

    // Merge config with defaults
    const fullConfig: DeveloperPortalServiceConfig = { ...DEFAULT_CONFIG, ...config };

    // Create service instance
    const service = new DeveloperPortalService(repository, fullConfig, {
      deliveryPublisher,
      replayStore,
      httpFetch,
      signingSecretResolver,
    });

    // Decorate fastify with the service
    fastify.decorate('developerPortalService', service);

    // PRC-H046: webhook delivery consumer + event fan-out producer.
    const logger = {
      info: (obj: Record<string, unknown>, msg: string) => fastify.log.info(obj, msg),
      error: (obj: Record<string, unknown>, msg: string) => fastify.log.error(obj, msg),
    };
    const lifecycle: Array<{ start(): Promise<void>; stop(): Promise<void> }> = [];
    if (deliveryPublisher && deliveryWorkerQueue) {
      const worker = createWebhookDeliveryWorker({
        queue: deliveryWorkerQueue,
        processor: service,
        logger,
      });
      fastify.decorate('webhookDeliveryWorker', worker);
      lifecycle.push(worker);
    } else if (deliveryPublisher) {
      fastify.log.warn('webhook delivery publisher configured without a consumer');
    }
    if (fanOutEvents.length > 0 && createFanOutQueue) {
      const fanOut = createWebhookEventFanOutSubscriber({
        events: fanOutEvents,
        createQueue: createFanOutQueue,
        processor: service,
        logger,
      });
      fastify.decorate('webhookFanOut', fanOut);
      lifecycle.push(fanOut);
    }
    if (lifecycle.length > 0) {
      fastify.addHook('onReady', async () => {
        for (const item of lifecycle) await item.start();
      });
      fastify.addHook('onClose', async () => {
        for (const item of [...lifecycle].reverse()) await item.stop();
      });
    }

    // Register routes
    await registerDeveloperPortalRoutes(fastify, { service, prefix });
  },
  {
    name: '@proctira/backend-developer-portal',
    fastify: '5.x',
    dependencies: [],
  },
);
