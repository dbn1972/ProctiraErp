/**
 * Fastify Notification Plugin
 *
 * Registers notification routes and service on a Fastify instance.
 * Provides the notification service as a decorator for other plugins to use.
 *
 * Requirements:
 * - 22.1: Multi-channel delivery (email, in-app, push, webhook)
 * - 22.2: Configurable notification rules based on entity events, thresholds, schedules
 * - 22.3: Deliver to all recipients matching configured role and area criteria
 * - 22.4: Template-based notifications with variable substitution
 * - 22.5: Track delivery status (sent, delivered, read, failed)
 * - 22.6: Retry email delivery up to 3 times with exponential backoff
 */
import type { QueueAdapter } from '@proctira/queue-abstraction';
import type { FastifyInstance } from 'fastify';
import fp from 'fastify-plugin';

import {
  createEmailSenderFromEnv,
  createPushSenderFromEnv,
  createSmsSenderFromEnv,
} from './channel-sender-factory.js';
import {
  createNotificationDeliveryWorker,
  type NotificationDeliveryWorker,
} from './notification-delivery-worker.js';
import type { NotificationRepository } from './notification-repository.js';
import {
  NotificationService,
  type EmailSender,
  type PushSender,
  type WebhookSender,
  type SmsSender,
  type NotificationQueuePublisher,
  type NotificationServiceConfig,
} from './notification-service.js';
import type { NotificationPrefsStore } from './prefs-store.js';
import { registerNotificationRoutes } from './routes.js';
import { createWebhookSenderFromEnv } from './webhook-sender.js';

/**
 * Options for the notification plugin.
 */
export interface NotificationPluginOptions {
  /** Notification repository implementation */
  repository: NotificationRepository;
  /** Preferences / device store (optional — defaults to in-memory) */
  prefsStore?: NotificationPrefsStore;
  /** Email sender implementation (optional) */
  emailSender?: EmailSender;
  /** Push notification sender implementation (optional) */
  pushSender?: PushSender;
  /** Webhook sender implementation (optional) */
  webhookSender?: WebhookSender;
  /** SMS sender implementation (optional — defaults to sandbox) */
  smsSender?: SmsSender;
  /** Queue publisher for retry scheduling (optional) */
  queuePublisher?: NotificationQueuePublisher;
  /**
   * g7_platform-003: dedicated consumer queue adapter for the in-process notification delivery
   * worker. When provided (and a queuePublisher is set), the worker is started onReady and
   * stopped onClose so published retry jobs are actually consumed. Without it, retries are
   * published but never processed (the durability gap this closes).
   */
  deliveryWorkerQueue?: QueueAdapter;
  /** Service configuration overrides */
  config?: Partial<NotificationServiceConfig>;
  /** Route prefix for notifications (default: '/notifications') */
  prefix?: string;
}

// Extend Fastify types
declare module 'fastify' {
  interface FastifyInstance {
    notificationService: NotificationService;
  }
}

/**
 * Fastify plugin that registers the notification service and routes.
 */
export const notificationPlugin = fp(
  async function notificationPluginImpl(
    fastify: FastifyInstance,
    options: NotificationPluginOptions,
  ) {
    const {
      repository,
      prefsStore,
      emailSender = createEmailSenderFromEnv(),
      pushSender = createPushSenderFromEnv(),
      webhookSender = createWebhookSenderFromEnv(),
      smsSender = createSmsSenderFromEnv(),
      queuePublisher,
      deliveryWorkerQueue,
      config,
      prefix = '/notifications',
    } = options;

    // Create notification service instance
    const notificationService = new NotificationService(
      repository,
      emailSender,
      pushSender,
      webhookSender,
      smsSender,
      queuePublisher,
      config,
    );

    // Decorate fastify with the notification service
    fastify.decorate('notificationService', notificationService);

    // g7_platform-003: when a durable queue publisher and a dedicated consumer adapter are both
    // configured, run the delivery/retry worker inside this process so published retry jobs are
    // consumed (mirrors developer-portal/workflow durable-consumer wiring). Lifecycle is bound to
    // onReady/onClose so the worker starts after the server is up and shuts down cleanly.
    if (queuePublisher && deliveryWorkerQueue) {
      const worker: NotificationDeliveryWorker = createNotificationDeliveryWorker({
        queue: deliveryWorkerQueue,
        processor: notificationService,
        logger: {
          info: (obj, msg) => fastify.log.info(obj, msg),
          error: (obj, msg) => fastify.log.error(obj, msg),
        },
      });
      fastify.addHook('onReady', async () => {
        await worker.start();
      });
      fastify.addHook('onClose', async () => {
        await worker.stop();
      });
    }

    // Register notification routes
    await registerNotificationRoutes(fastify, {
      notificationService,
      prefsStore,
      prefix,
    });
  },
  {
    name: '@proctira/backend-notification',
    fastify: '5.x',
    dependencies: [],
  },
);
