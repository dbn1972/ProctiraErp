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
  /** PRC-H046: fresh (unconnected) adapter on the same backend for consumers. */
  createConsumerAdapter(): QueueAdapter;
  disconnect(): Promise<void>;
}

function buildAdapterFromEnv(
  backend: string | undefined,
  rabbitUrl: string | undefined,
): QueueAdapter {
  if (backend) {
    return createQueueAdapterFromEnv();
  }
  return createQueueAdapter({
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

export async function createWebhookDeliveryPublisherFromEnv(): Promise<WebhookDeliveryPublisherHandle | null> {
  const backend = process.env['QUEUE_BACKEND'];
  const rabbitUrl = process.env['RABBITMQ_URL'];

  if (!backend && !rabbitUrl) {
    return null;
  }

  const adapter = buildAdapterFromEnv(backend, rabbitUrl);
  await adapter.connect();
  return {
    publisher: new QueueWebhookDeliveryPublisher(adapter),
    adapter,
    createConsumerAdapter: () => buildAdapterFromEnv(backend, rabbitUrl),
    disconnect: () => adapter.disconnect(),
  };
}
