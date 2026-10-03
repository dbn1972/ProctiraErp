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
  /** In-flight tick promise so stop() can wait for it (PRC-M363). */
  private inFlight: Promise<number> | null = null;
  private connecting: Promise<void> | null = null;

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
    if (this.inFlight) return 0;
    this.inFlight = this.runTick().finally(() => {
      this.inFlight = null;
    });
    return this.inFlight;
  }

  /**
   * One batch. Never rejects (PRC-M363): store/broker outages are logged and the
   * next interval retries, so timers cannot raise unhandled promise rejections.
   */
  private async runTick(): Promise<number> {
    let rows: OutboxRecord[];
    try {
      rows = await this.store.claimPending(this.batchSize);
    } catch (err: unknown) {
      this.logger?.error?.({ err: errorMessage(err) }, 'outbox claimPending failed');
      return 0;
    }
    let published = 0;
    for (const row of rows) {
      try {
        await this.deliver(row);
        await this.store.markPublished(row.id);
        published += 1;
      } catch (err: unknown) {
        const message = errorMessage(err);
        this.logger?.error?.({ outboxId: row.id, err: message }, 'outbox publish failed');
        try {
          if (row.attempts >= this.maxAttempts) {
            await this.store.markFailed(row.id, message);
          } else {
            const delay = this.retryBackoffMs * Math.max(1, row.attempts);
            await this.store.markFailed(row.id, message, new Date(Date.now() + delay));
          }
        } catch (markErr: unknown) {
          this.logger?.error?.(
            { outboxId: row.id, err: errorMessage(markErr) },
            'outbox markFailed failed',
          );
        }
      }
    }
    return published;
  }

  private ensureConnected(): void {
    if (this.queue.isConnected() || this.connecting) return;
    this.connecting = this.queue
      .connect()
      .catch((err: unknown) => {
        // Surface connect failures; the next interval retries.
        this.logger?.error?.({ err: errorMessage(err) }, 'outbox queue connect failed');
      })
      .finally(() => {
        this.connecting = null;
      });
  }

  start(): void {
    if (this.timer) return;
    this.ensureConnected();
    this.timer = setInterval(() => {
      if (!this.queue.isConnected()) {
        this.ensureConnected();
      }
      this.tick().catch((err: unknown) => {
        this.logger?.error?.({ err: errorMessage(err) }, 'outbox tick failed');
      });
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
    // PRC-M363: wait for an in-flight tick before the final drain.
    if (this.inFlight) {
      await this.inFlight;
    }
    await this.tick();
  }

  private async deliver(row: OutboxRecord): Promise<void> {
    // PRC-M360: scheduling is the outbox's job (availableAt, enforced by
    // claimPending). A row is only claimed once due, so any legacy
    // metadata.delay is stripped and never handed to the transport.
    const { delay: _ignoredDelay, ...rowMetadata } = row.metadata ?? {};
    const message: QueueMessage = {
      id: randomUUID(),
      tenantId: row.tenantId,
      type: row.eventType,
      payload: row.payload,
      timestamp: new Date().toISOString(),
      metadata: {
        ...rowMetadata,
        causationId: row.id,
        headers: {
          ...(row.metadata?.headers ?? {}),
          'x-outbox-id': row.id,
          'x-aggregate-type': row.aggregateType,
          'x-aggregate-id': row.aggregateId,
        },
      },
    };

    const priority = typeof row.metadata?.priority === 'number' ? row.metadata.priority : undefined;

    if (row.dispatchMode === 'publish') {
      await this.queue.publish(message);
    } else {
      await this.queue.dispatch(message, {
        ...(priority !== undefined ? { priority } : {}),
      });
    }
    this.logger?.info?.(
      { outboxId: row.id, eventType: row.eventType, tenantId: row.tenantId },
      'outbox published',
    );
  }
}

function errorMessage(err: unknown): string {
  return err instanceof Error ? err.message : String(err);
}
