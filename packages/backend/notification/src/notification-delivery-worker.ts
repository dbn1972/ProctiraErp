/**
 * Notification delivery consumer helper (W2-JOB-01).
 *
 * Consumes `tenant.*.notification.delivery` jobs and calls
 * NotificationService.processQueuedDelivery. Survives process restart when the
 * queue backend retains unacked messages (RabbitMQ) or a shared durable store
 * (InMemoryDurableQueueAdapter for proofs). Ack happens only after the handler
 * succeeds (autoAck: false).
 */
import type { QueueAdapter, QueueMessage } from '@proctira/queue-abstraction';
import {
  NOTIFICATION_DELIVERY_CONSUME_TOPIC,
  NOTIFICATION_DELIVERY_JOB_TYPE,
} from '@proctira/queue-abstraction';

import type { NotificationDeliveryJobPayload } from './queue-notification-publisher.js';

export interface NotificationDeliveryWorkerLogger {
  info(obj: Record<string, unknown>, msg: string): void;
  error(obj: Record<string, unknown>, msg: string): void;
}

export interface NotificationDeliveryProcessor {
  processQueuedDelivery(tenantId: string, notificationId: string): Promise<boolean>;
}

export interface NotificationDeliveryWorkerOptions {
  queue: QueueAdapter;
  processor: NotificationDeliveryProcessor;
  /** RabbitMQ / memory consume topic pattern (default: all tenants). */
  topic?: string;
  groupId?: string;
  logger?: NotificationDeliveryWorkerLogger;
}

export interface NotificationDeliveryWorker {
  start(): Promise<void>;
  stop(): Promise<void>;
  readonly running: boolean;
}

function isDeliveryPayload(payload: unknown): payload is NotificationDeliveryJobPayload {
  return (
    typeof payload === 'object' &&
    payload !== null &&
    typeof (payload as NotificationDeliveryJobPayload).notificationId === 'string' &&
    typeof (payload as NotificationDeliveryJobPayload).tenantId === 'string'
  );
}

export function createNotificationDeliveryWorker(
  options: NotificationDeliveryWorkerOptions,
): NotificationDeliveryWorker {
  let running = false;

  return {
    get running() {
      return running;
    },
    async start() {
      if (running) return;
      const topic = options.topic ?? NOTIFICATION_DELIVERY_CONSUME_TOPIC;
      if (!options.queue.isConnected()) {
        await options.queue.connect();
      }
      await options.queue.consume(
        {
          topic,
          groupId: options.groupId ?? 'notification-delivery-workers',
          autoAck: false,
        },
        async (message: QueueMessage) => {
          if (
            message.type !== NOTIFICATION_DELIVERY_JOB_TYPE &&
            !isDeliveryPayload(message.payload)
          ) {
            options.logger?.error(
              { type: message.type, id: message.id },
              'notification-delivery worker ignored unexpected message',
            );
            return;
          }
          if (!isDeliveryPayload(message.payload)) {
            throw new Error(`Invalid notification delivery payload on message ${message.id}`);
          }
          const { notificationId, tenantId } = message.payload;
          options.logger?.info(
            { tenantId, notificationId, messageId: message.id },
            'notification-delivery worker processing job',
          );
          await options.processor.processQueuedDelivery(tenantId, notificationId);
          options.logger?.info(
            { tenantId, notificationId },
            'notification-delivery worker completed job',
          );
        },
      );
      running = true;
      options.logger?.info({ topic }, 'notification-delivery worker started');
    },
    async stop() {
      if (!running) return;
      await options.queue.disconnect();
      running = false;
      options.logger?.info({}, 'notification-delivery worker stopped');
    },
  };
}
