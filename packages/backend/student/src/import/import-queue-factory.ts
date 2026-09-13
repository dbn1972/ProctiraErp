/**
 * Optional env-driven ImportQueue for the API gateway (W2-JOB-06).
 * When QUEUE_BACKEND / RABBITMQ_URL is configured, publishes import jobs onto
 * the durable queue spine. Otherwise returns null (in-memory queue default).
 */
import type { QueueAdapter } from '@proctira/queue-abstraction';
import { createQueueAdapter, createQueueAdapterFromEnv } from '@proctira/queue-abstraction';

import { QueueImportQueue } from './queue-import-queue.js';
import type { ImportQueue } from './types.js';

export interface StudentImportQueueHandle {
  importQueue: ImportQueue;
  adapter: QueueAdapter;
  disconnect(): Promise<void>;
}

export async function createStudentImportQueueFromEnv(): Promise<StudentImportQueueHandle | null> {
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
    importQueue: new QueueImportQueue(adapter),
    adapter,
    disconnect: () => adapter.disconnect(),
  };
}
