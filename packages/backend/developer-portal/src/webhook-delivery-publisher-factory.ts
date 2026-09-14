/**
 * Optional env-driven webhook delivery publisher (W2-JOB-07).
 */
import type { QueueAdapter } from '@proctira/queue-abstraction';
import { createQueueAdapter, createQueueAdapterFromEnv } from '@proctira/queue-abstraction';

import {
  QueueWebhookDeliveryPublisher,
  type WebhookDeliveryPublisher,
} from './queue-webhook-delivery-publisher.js';

export interface WebhookDeliveryPublisherHandle {
  publisher: WebhookDeliveryPublisher;
  adapter: QueueAdapter;
  disconnect(): Promise<void>;
}

export async function createWebhookDeliveryPublisherFromEnv(): Promise<WebhookDeliveryPublisherHandle | null> {
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
    publisher: new QueueWebhookDeliveryPublisher(adapter),
    adapter,
    disconnect: () => adapter.disconnect(),
  };
}
