/**
 * Optional env-driven webhook delivery publisher (W2-JOB-07; PRC-H046 via outbox).
 */
import { getSharedPgPool } from '@proctira/database';
import type { OutboxStore, QueueAdapter } from '@proctira/queue-abstraction';
import {
  createQueueAdapter,
  createQueueAdapterFromEnv,
  InMemoryOutboxStore,
  OutboxRelay,
  PgOutboxStore,
} from '@proctira/queue-abstraction';
import {
  OutboxWebhookDeliveryPublisher,
  type WebhookDeliveryPublisher,
} from './queue-webhook-delivery-publisher.js';

export interface WebhookDeliveryPublisherHandle {
  publisher: WebhookDeliveryPublisher;
  adapter: QueueAdapter;
  /** PRC-H046: fresh (unconnected) adapter on the same backend for consumers. */
  createConsumerAdapter(): QueueAdapter;
  /** PRC-H046: delivery jobs go through the transactional outbox. */
  outboxStore: OutboxStore;
  relay: OutboxRelay;
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
  // PRC-H046: PG outbox when DATABASE_URL is set, else in-memory (single process).
  const pool = getSharedPgPool();
  const outboxStore: OutboxStore = pool ? new PgOutboxStore(pool) : new InMemoryOutboxStore();
  const relay = new OutboxRelay({
    store: outboxStore,
    queue: adapter,
    pollIntervalMs: Number(process.env['OUTBOX_POLL_MS'] ?? 500),
  });
  relay.start();
  return {
    publisher: new OutboxWebhookDeliveryPublisher(outboxStore),
    adapter,
    createConsumerAdapter: () => buildAdapterFromEnv(backend, rabbitUrl),
    outboxStore,
    relay,
    disconnect: async () => {
      await relay.stop();
      await adapter.disconnect();
    },
  };
}
