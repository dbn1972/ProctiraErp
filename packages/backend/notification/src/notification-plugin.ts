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
import type { FastifyInstance } from 'fastify';
import fp from 'fastify-plugin';

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
import { createSandboxEmailSender } from './sandbox-email-sender.js';
import { createSandboxPushSender } from './sandbox-push-sender.js';
import { createSandboxSmsSender } from './sandbox-sms-sender.js';

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
      emailSender = createSandboxEmailSender(),
      pushSender = createSandboxPushSender(),
      webhookSender,
      smsSender = createSandboxSmsSender(),
      queuePublisher,
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

    // Register notification routes
    await registerNotificationRoutes(fastify, {
      notificationService,
      prefsStore,
      prefix,
    });
  },
  {
    name: '@proctira/backend-notification',
    fastify: '4.x',
    dependencies: [],
  },
);
