/**
 * Optional env-driven durable publishers for privacy jobs (W1-SEC-06).
 * When QUEUE_BACKEND / RABBITMQ_URL is set, returns connected adapters.
 */
import type { QueueAdapter } from '@proctira/queue-abstraction';
import { createQueueAdapter, createQueueAdapterFromEnv } from '@proctira/queue-abstraction';

import {
  QueuePrivacyAnonymizationPublisher,
  QueuePrivacyOffboardPublisher,
  type PrivacyAnonymizationPublisher,
  type PrivacyOffboardPublisher,
} from './queue-privacy-publisher.js';

export interface PrivacyQueueHandle {
  anonymizationPublisher: PrivacyAnonymizationPublisher;
  offboardPublisher: PrivacyOffboardPublisher;
  adapter: QueueAdapter;
  disconnect(): Promise<void>;
}

export async function createPrivacyQueuePublishersFromEnv(): Promise<PrivacyQueueHandle | null> {
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
    anonymizationPublisher: new QueuePrivacyAnonymizationPublisher(adapter),
    offboardPublisher: new QueuePrivacyOffboardPublisher(adapter),
    adapter,
    disconnect: () => adapter.disconnect(),
  };
}
