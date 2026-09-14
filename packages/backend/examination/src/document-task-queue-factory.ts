/**
 * Optional env-driven outbox + QueueAdapter for exam document jobs (W2-JOB-04).
 *
 * When QUEUE_BACKEND / RABBITMQ_URL is configured:
 * - Writes go to the transactional outbox (PG when DATABASE_URL set, else
 *   in-process InMemoryOutboxStore for single-process proofs).
 * - OutboxRelay publishes via QueueAdapter — no createJob→dispatch dual-write.
 */
import { getSharedPgPool } from '@proctira/database';
import type { QueueAdapter } from '@proctira/queue-abstraction';
import {
  createQueueAdapter,
  createQueueAdapterFromEnv,
  InMemoryOutboxStore,
  OutboxRelay,
  PgOutboxStore,
  type OutboxStore,
} from '@proctira/queue-abstraction';

export interface DocumentOutboxHandle {
  outboxStore: OutboxStore;
  adapter: QueueAdapter;
  relay: OutboxRelay;
  disconnect(): Promise<void>;
}

/**
 * Build outbox + relay from environment, or `null` when queue backends are
 * not configured (dev / unit-test default → NoOp document task queue).
 */
export async function createDocumentOutboxFromEnv(): Promise<DocumentOutboxHandle | null> {
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
    outboxStore,
    adapter,
    relay,
    disconnect: async () => {
      await relay.stop();
      await adapter.disconnect();
    },
  };
}

/**
 * @deprecated Prefer {@link createDocumentOutboxFromEnv} (W2-JOB-04).
 * Kept for callers that still want a direct QueueDocumentTaskQueue dual-write.
 */
export async function createDocumentTaskQueueFromEnv(): Promise<DocumentOutboxHandle | null> {
  return createDocumentOutboxFromEnv();
}

/** @deprecated Use DocumentOutboxHandle */
export type DocumentTaskQueueHandle = DocumentOutboxHandle;
