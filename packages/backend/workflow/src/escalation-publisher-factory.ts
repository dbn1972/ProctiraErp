/**
 * Optional env-driven EscalationPublisher for the API gateway (P1-WF / W2-JOB-03).
 *
 * When QUEUE_BACKEND / RABBITMQ_URL is configured:
 * - Escalation tasks go to the transactional outbox (PG when DATABASE_URL set,
 *   else InMemoryOutboxStore for single-process proofs).
 * - OutboxRelay publishes via QueueAdapter — no createInstance→dispatch dual-write.
 * Otherwise returns null (EscalationService stays unwired — same honesty as P0-06).
 */
import { getSharedPgPool } from '@proctira/database';
import type { QueueAdapter, OutboxStore } from '@proctira/queue-abstraction';
import {
  createQueueAdapter,
  createQueueAdapterFromEnv,
  InMemoryOutboxStore,
  OutboxRelay,
  PgOutboxStore,
} from '@proctira/queue-abstraction';

import type { EscalationPublisher } from './escalation-service.js';
import { OutboxEscalationPublisher } from './outbox-escalation-publisher.js';

export interface EscalationPublisherHandle {
  publisher: EscalationPublisher;
  adapter: QueueAdapter;
  outboxStore: OutboxStore;
  relay: OutboxRelay;
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

  const pool = getSharedPgPool();
  const outboxStore: OutboxStore = pool ? new PgOutboxStore(pool) : new InMemoryOutboxStore();

  const relay = new OutboxRelay({
    store: outboxStore,
    queue: adapter,
    pollIntervalMs: Number(process.env['OUTBOX_POLL_MS'] ?? 500),
    logger: {
      info: (obj, msg) => console.info(JSON.stringify({ level: 'info', msg, ...obj })),
      error: (obj, msg) => console.error(JSON.stringify({ level: 'error', msg, ...obj })),
    },
  });
  relay.start();

  return {
    publisher: new OutboxEscalationPublisher(outboxStore, adapter),
    adapter,
    outboxStore,
    relay,
    disconnect: async () => {
      await relay.stop();
      await adapter.disconnect();
    },
  };
}
