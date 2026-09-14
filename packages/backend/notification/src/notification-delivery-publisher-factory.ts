/**
 * Optional env-driven NotificationQueuePublisher for the API gateway (W2-JOB-01).
 * When QUEUE_BACKEND / RABBITMQ_URL is configured, publishes notification
 * delivery/retry jobs onto the durable queue spine. Otherwise returns null
 * (in-process delivery only — same honesty as exam-document P0-06).
 */
import type { QueueAdapter } from '@proctira/queue-abstraction';
import { createQueueAdapter, createQueueAdapterFromEnv } from '@proctira/queue-abstraction';

import type { NotificationQueuePublisher } from './notification-service.js';
import { QueueNotificationDeliveryPublisher } from './queue-notification-publisher.js';

export interface NotificationDeliveryPublisherHandle {
  publisher: NotificationQueuePublisher;
  adapter: QueueAdapter;
  disconnect(): Promise<void>;
}

/**
 * Build a durable notification delivery publisher from environment, or `null`
 * when queue backends are not configured (dev / unit-test default).
 */
export async function createNotificationDeliveryPublisherFromEnv(): Promise<NotificationDeliveryPublisherHandle | null> {
  const backend = process.env['QUEUE_BACKEND'];
  const rabbitUrl = process.env['RABBITMQ_URL'];

  if (!backend && !rabbitUrl) {
    return null;
  }

  let adapter: QueueAdapter;
  if (backend) {
    adapter = createQueueAdapterFromEnv();
  } else {
    adapter = createQueueAdapter({
      backend: 'rabbitmq',
      rabbitmq: {
        url: rabbitUrl!,
        exchange: process.env['RABBITMQ_EXCHANGE'] ?? 'proctira.events',
        exchangeType: 'topic',
        deadLetterExchange: process.env['RABBITMQ_DLX'] ?? 'dlx',
        durable: true,
      },
    });
  }

  await adapter.connect();
  return {
    publisher: new QueueNotificationDeliveryPublisher(adapter),
    adapter,
    disconnect: () => adapter.disconnect(),
  };
}
