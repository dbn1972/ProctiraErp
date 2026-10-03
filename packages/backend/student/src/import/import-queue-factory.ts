/**
 * Optional env-driven ImportQueue for the API gateway (W2-JOB-06).
 * When QUEUE_BACKEND / RABBITMQ_URL is configured, publishes import jobs onto
 * the durable queue spine. Otherwise returns null (in-memory queue default).
 */
import type { QueueAdapter } from '@proctira/queue-abstraction';
import { createQueueAdapter, createQueueAdapterFromEnv } from '@proctira/queue-abstraction';

import { createImportProgressStoreFromEnv } from './progress-store.js';
import { QueueImportQueue } from './queue-import-queue.js';
import type { ImportQueue } from './types.js';

export interface StudentImportQueueHandle {
  importQueue: ImportQueue;
  adapter: QueueAdapter;
  /** PRC-H092: fresh (unconnected) adapter on the same backend for the worker. */
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

export async function createStudentImportQueueFromEnv(): Promise<StudentImportQueueHandle | null> {
  const backend = process.env['QUEUE_BACKEND'];
  const rabbitUrl = process.env['RABBITMQ_URL'];

  if (!backend && !rabbitUrl) {
    return null;
  }

  const adapter = buildAdapterFromEnv(backend, rabbitUrl);
  await adapter.connect();
  return {
    // PRC-H092: Redis-persisted (tenant, job) progress when REDIS_URL is set.
    importQueue: new QueueImportQueue(adapter, createImportProgressStoreFromEnv()),
    adapter,
    createConsumerAdapter: () => buildAdapterFromEnv(backend, rabbitUrl),
    disconnect: () => adapter.disconnect(),
  };
}
