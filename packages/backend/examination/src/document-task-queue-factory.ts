/**
 * Optional env-driven DocumentTaskQueue for the API gateway.
 * When QUEUE_BACKEND / RABBITMQ_URL is configured, publishes exam document
 * jobs onto the durable queue spine. Otherwise returns undefined (NoOp path).
 */
import type { QueueAdapter } from '@proctira/queue-abstraction';
import { createQueueAdapter, createQueueAdapterFromEnv } from '@proctira/queue-abstraction';

import type { DocumentTaskQueue } from './document-generation-service.js';
import { QueueDocumentTaskQueue } from './queue-document-task-queue.js';

export interface DocumentTaskQueueHandle {
  queue: DocumentTaskQueue;
  adapter: QueueAdapter;
  disconnect(): Promise<void>;
}

/**
 * Build a durable document task queue from environment, or `null` when
 * queue backends are not configured (dev / unit-test default).
 */
export async function createDocumentTaskQueueFromEnv(): Promise<DocumentTaskQueueHandle | null> {
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
    queue: new QueueDocumentTaskQueue(adapter),
    adapter,
    disconnect: () => adapter.disconnect(),
  };
}
