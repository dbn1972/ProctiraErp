/**
 * Transactional outbox types (W2-JOB-04).
 *
 * Domain writers insert an outbox row in the same DB transaction as their
 * business data. A relay later publishes via QueueAdapter.dispatch/publish.
 */
import type { QueueMessageMetadata } from '../types.js';

export type OutboxStatus = 'pending' | 'published' | 'failed';

/** How the relay should deliver the message on the QueueAdapter. */
export type OutboxDispatchMode = 'dispatch' | 'publish';

export interface NewOutboxEntry {
  id: string;
  tenantId: string;
  aggregateType: string;
  aggregateId: string;
  /** QueueMessage.type / routing key leaf (e.g. exam.document.generate). */
  eventType: string;
  payload: unknown;
  metadata?: QueueMessageMetadata;
  /** Default: dispatch (work queue). */
  dispatchMode?: OutboxDispatchMode;
  availableAt?: Date;
}

export interface OutboxRecord extends NewOutboxEntry {
  status: OutboxStatus;
  attempts: number;
  lastError?: string;
  createdAt: Date;
  publishedAt?: Date;
  availableAt: Date;
  dispatchMode: OutboxDispatchMode;
}

/**
 * Minimal SQL surface so PG store works with node-pg Pool/Client
 * or a Prisma transaction adapter without importing pg at the type level.
 */
export interface OutboxQueryable {
  query: (
    text: string,
    values?: unknown[],
  ) => Promise<{ rows: unknown[] } & Record<string, unknown>>;
}
