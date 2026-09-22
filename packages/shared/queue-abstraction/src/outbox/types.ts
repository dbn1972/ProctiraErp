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

/**
 * One `failed` -> `pending` redrive, appended to `redrive_history`.
 *
 * Volume 5 §6 requires redrive to be audited, so `actor` and `reason` are
 * required by `requeueFailed` rather than optional: an anonymous redrive of a
 * tenant's unpublished domain events is not an auditable operation.
 */
export interface OutboxRedriveEntry {
  at: string;
  /** Who requested it. A user id, or a named system process. */
  actor: string;
  reason: string;
  /** `attempts` at the moment of redrive, before the counter was reset. */
  fromAttempts: number;
}

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
  /** Append-only redrive trail. Empty for rows that were never redriven. */
  redriveHistory: OutboxRedriveEntry[];
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
