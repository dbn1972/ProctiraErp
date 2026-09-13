/**
 * Outbox relay — publishes pending rows via QueueAdapter (W2-JOB-04).
 *
 * At-least-once: markPublished only after successful dispatch/publish.
 * On failure, optionally reschedule via markFailed(..., availableAt).
 */
import { randomUUID } from 'node:crypto';

import type { QueueAdapter, QueueMessage } from '../types.js';

import type { OutboxStore } from './store.js';
import type { OutboxRecord } from './types.js';

export interface OutboxRelayOptions {
  store: OutboxStore;
  queue: QueueAdapter;
  /** Rows claimed per tick (default 32). */
  batchSize?: number;
  /** Poll interval when start() is used (default 500ms). */
  pollIntervalMs?: number;
  /** Base backoff (ms) on publish failure before retry (default 1000). */
  retryBackoffMs?: number;
  /** Max attempts before permanent failed (default 10). */
  maxAttempts?: number;
  logger?: {
    info?: (obj: Record<string, unknown>, msg: string) => void;
    error?: (obj: Record<string, unknown>, msg: string) => void;
  };
}

export class OutboxRelay {
  private readonly store: OutboxStore;
  private readonly queue: QueueAdapter;
  private readonly batchSize: number;
  private readonly pollIntervalMs: number;
  private readonly retryBackoffMs: number;
  private readonly maxAttempts: number;
  private readonly logger: OutboxRelayOptions['logger'];
  private timer: ReturnType<typeof setInterval> | null = null;
  private ticking = false;

  constructor(options: OutboxRelayOptions) {
    this.store = options.store;
    this.queue = options.queue;
    this.batchSize = options.batchSize ?? 32;
    this.pollIntervalMs = options.pollIntervalMs ?? 500;
    this.retryBackoffMs = options.retryBackoffMs ?? 1000;
    this.maxAttempts = options.maxAttempts ?? 10;
    this.logger = options.logger;
  }

  /** Process one batch of pending outbox rows. */
  async tick(): Promise<number> {
    if (this.ticking) return 0;
    this.ticking = true;
    try {
      const rows = await this.store.claimPending(this.batchSize);
      let published = 0;
      for (const row of rows) {
        try {
          await this.deliver(row);
          await this.store.markPublished(row.id);
          published += 1;
        } catch (err: unknown) {
          const message = err instanceof Error ? err.message : String(err);
          this.logger?.error?.({ outboxId: row.id, err: message }, 'outbox publish failed');
          if (row.attempts >= this.maxAttempts) {
            await this.store.markFailed(row.id, message);
          } else {
            const delay = this.retryBackoffMs * Math.max(1, row.attempts);
            await this.store.markFailed(row.id, message, new Date(Date.now() + delay));
          }
        }
      }
      return published;
    } finally {
      this.ticking = false;
    }
  }

  start(): void {
    if (this.timer) return;
    if (!this.queue.isConnected()) {
      void this.queue.connect();
    }
    this.timer = setInterval(() => {
      void this.tick();
    }, this.pollIntervalMs);
    // Unref so relay polling does not keep vitest / short-lived processes alive.
    if (typeof this.timer === 'object' && 'unref' in this.timer) {
      this.timer.unref();
    }
  }

  async stop(): Promise<void> {
    if (this.timer) {
      clearInterval(this.timer);
      this.timer = null;
    }
    // Drain once on stop.
    await this.tick();
  }

  private async deliver(row: OutboxRecord): Promise<void> {
    const message: QueueMessage = {
      id: randomUUID(),
      tenantId: row.tenantId,
      type: row.eventType,
      payload: row.payload,
      timestamp: new Date().toISOString(),
      metadata: {
        ...row.metadata,
        causationId: row.id,
        headers: {
          ...(row.metadata?.headers ?? {}),
          'x-outbox-id': row.id,
          'x-aggregate-type': row.aggregateType,
          'x-aggregate-id': row.aggregateId,
        },
      },
    };

    const delay =
      typeof row.metadata?.delay === 'number' ? row.metadata.delay : undefined;
    const priority =
      typeof row.metadata?.priority === 'number' ? row.metadata.priority : undefined;

    if (row.dispatchMode === 'publish') {
      await this.queue.publish(message);
    } else {
      await this.queue.dispatch(message, {
        ...(delay !== undefined ? { delay } : {}),
        ...(priority !== undefined ? { priority } : {}),
      });
    }
    this.logger?.info?.(
      { outboxId: row.id, eventType: row.eventType, tenantId: row.tenantId },
      'outbox published',
    );
  }
}
