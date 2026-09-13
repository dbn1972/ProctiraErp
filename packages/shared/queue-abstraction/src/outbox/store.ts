/**
 * Outbox store contract — durable pending queue messages (W2-JOB-04).
 */
import type { NewOutboxEntry, OutboxQueryable, OutboxRecord } from './types.js';

export interface OutboxStore {
  /**
   * Insert a pending outbox row.
   * When `client` is provided, the insert uses that connection so it can
   * share a transaction with domain writes.
   */
  enqueue(entry: NewOutboxEntry, client?: OutboxQueryable): Promise<OutboxRecord>;

  /** Claim pending rows that are due (status=pending, available_at <= now). */
  claimPending(limit: number, now?: Date): Promise<OutboxRecord[]>;

  markPublished(id: string, publishedAt?: Date): Promise<void>;

  /**
   * Record a publish failure. Optionally schedule a retry via `availableAt`.
   * When `availableAt` is omitted, status becomes `failed` (no automatic retry).
   */
  markFailed(id: string, error: string, availableAt?: Date): Promise<void>;

  /** Test helper: pending rows still waiting for relay. */
  listPending?(): Promise<OutboxRecord[]>;
}
