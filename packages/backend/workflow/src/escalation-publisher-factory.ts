/**
 * Optional env-driven EscalationPublisher for the API gateway (P1-WF).
 * When QUEUE_BACKEND / RABBITMQ_URL is configured, publishes workflow
 * escalation jobs onto the durable queue spine. Otherwise returns null
 * (EscalationService stays unwired — same honesty as exam-document P0-06).
 */
import type { QueueAdapter } from '@proctira/queue-abstraction';
import { createQueueAdapter, createQueueAdapterFromEnv } from '@proctira/queue-abstraction';

import type { EscalationPublisher } from './escalation-service.js';
import { QueueEscalationPublisher } from './queue-escalation-publisher.js';

export interface EscalationPublisherHandle {
  publisher: EscalationPublisher;
  adapter: QueueAdapter;
  disconnect(): Promise<void>;
}

/**
 * Build a durable escalation publisher from environment, or `null` when
 * queue backends are not configured (dev / unit-test default).
 */
export async function createEscalationPublisherFromEnv(): Promise<EscalationPublisherHandle | null> {
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
    publisher: new QueueEscalationPublisher(adapter),
    adapter,
    disconnect: () => adapter.disconnect(),
  };
}
